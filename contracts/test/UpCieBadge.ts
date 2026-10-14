import { expect } from "chai";
import type { Interface } from "ethers";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

const LSP4_TOKEN_TYPE_KEY = "0xe0261fa95db2eb3b5439bd033cda66d56b96f92f243a8228fd87550ed7bdfdb3";
const LSP8_TOKENID_FORMAT_KEY = "0xf675e9361af1c1664c1868cfa3eb97672d6b1a513aa5b81dec34c9ee330e818d";
const CIE = ethers.encodeBytes32String("CIE");
const reason = (s: string) => ethers.encodeBytes32String(s);
const OP_CALL = 0;
const YEAR = 365 * 24 * 3600;

enum Status {
  None,
  Valid,
  Invalidated,
  Revoked,
}

async function deployFixture() {
  const [deployer, ownerController, attester, holderController, other] = await ethers.getSigners();

  // Owner = a real Universal Profile (LSP0) controlled by an EOA, as in production (ChainIntegrate UP).
  const ownerUp = await ethers.deployContract("TestUniversalProfile", [ownerController.address]);
  const holderUp = await ethers.deployContract("TestUniversalProfile", [holderController.address]);
  const holderUp2 = await ethers.deployContract("TestUniversalProfile", [holderController.address]);
  const noLsp1 = await ethers.deployContract("NoLSP1Receiver");

  const badge = await ethers.deployContract("UpCieBadge", [await ownerUp.getAddress(), attester.address]);
  const badgeAddress = await badge.getAddress();

  // Calls an owner-only function through the owner UP.
  const asOwner = (fn: string, args: unknown[]) =>
    ownerUp.connect(ownerController).execute(OP_CALL, badgeAddress, 0, (badge.interface as Interface).encodeFunctionData(fn, args));
  // Calls a function as the holder UP (e.g. renounce).
  const asHolder = (fn: string, args: unknown[]) =>
    holderUp.connect(holderController).execute(OP_CALL, badgeAddress, 0, (badge.interface as Interface).encodeFunctionData(fn, args));

  const expiry = async (seconds = 7 * YEAR) => BigInt(await time.latest()) + BigInt(seconds);

  return { badge, ownerUp, holderUp, holderUp2, noLsp1, deployer, ownerController, attester, holderController, other, asOwner, asHolder, expiry };
}

describe("UpCieBadge", function () {
  describe("deployment", function () {
    it("sets owner, attester, name and LSP4/LSP8 metadata", async function () {
      const { badge, ownerUp, attester } = await loadFixture(deployFixture);
      expect(await badge.owner()).to.equal(await ownerUp.getAddress());
      expect(await badge.attester()).to.equal(attester.address);
      const abi = ethers.AbiCoder.defaultAbiCoder();
      expect(abi.decode(["uint256"], await badge.getData(LSP4_TOKEN_TYPE_KEY))[0]).to.equal(1n);
      expect(abi.decode(["uint256"], await badge.getData(LSP8_TOKENID_FORMAT_KEY))[0]).to.equal(2n);
      // LSP4TokenName = keccak256("LSP4TokenName")
      const name = await badge.getData(ethers.id("LSP4TokenName"));
      expect(ethers.toUtf8String(name)).to.equal("UP CIE Link");
    });

    it("derives the tokenId from the UP address", async function () {
      const { badge, holderUp } = await loadFixture(deployFixture);
      const up = await holderUp.getAddress();
      expect(await badge.tokenIdOf(up)).to.equal(ethers.zeroPadValue(up, 32));
    });
  });

  describe("attest", function () {
    it("mints the badge to a Universal Profile", async function () {
      const { badge, holderUp, attester, expiry } = await loadFixture(deployFixture);
      const up = await holderUp.getAddress();
      const exp = await expiry();
      await expect(badge.connect(attester).attest(up, CIE, exp))
        .to.emit(badge, "Attested")
        .withArgs(up, await badge.tokenIdOf(up), CIE, (v: bigint) => v > 0n, exp);
      expect(await badge.tokenOwnerOf(await badge.tokenIdOf(up))).to.equal(up);
      expect(await badge.balanceOf(up)).to.equal(1n);
      expect(await badge.isVerified(up)).to.equal(true);
      const a = await badge.getAttestation(up);
      expect(a.source).to.equal(CIE);
      expect(a.expiresAt).to.equal(exp);
      expect(a.status).to.equal(Status.Valid);
    });

    it("reverts for callers other than the attester", async function () {
      const { badge, holderUp, other, expiry } = await loadFixture(deployFixture);
      await expect(badge.connect(other).attest(await holderUp.getAddress(), CIE, await expiry()))
        .to.be.revertedWithCustomError(badge, "NotAttester")
        .withArgs(other.address);
    });

    it("reverts towards an EOA or a contract without LSP1", async function () {
      const { badge, attester, other, noLsp1, expiry } = await loadFixture(deployFixture);
      await expect(badge.connect(attester).attest(other.address, CIE, await expiry())).to.be.revertedWithCustomError(
        badge,
        "LSP8NotifyTokenReceiverIsEOA",
      );
      await expect(
        badge.connect(attester).attest(await noLsp1.getAddress(), CIE, await expiry()),
      ).to.be.revertedWithCustomError(badge, "LSP8NotifyTokenReceiverContractMissingLSP1Interface");
    });

    it("reverts for the zero address or an expiry not in the future", async function () {
      const { badge, holderUp, attester } = await loadFixture(deployFixture);
      await expect(badge.connect(attester).attest(ethers.ZeroAddress, CIE, 2n ** 63n)).to.be.revertedWithCustomError(
        badge,
        "InvalidUniversalProfile",
      );
      const now = BigInt(await time.latest());
      await expect(badge.connect(attester).attest(await holderUp.getAddress(), CIE, now))
        .to.be.revertedWithCustomError(badge, "ExpiryNotInFuture");
    });

    it("two UPs get two distinct tokens, each owned by its UP", async function () {
      const { badge, holderUp, holderUp2, attester, expiry } = await loadFixture(deployFixture);
      const up1 = await holderUp.getAddress();
      const up2 = await holderUp2.getAddress();
      await badge.connect(attester).attest(up1, CIE, await expiry());
      await badge.connect(attester).attest(up2, CIE, await expiry());
      const id1 = await badge.tokenIdOf(up1);
      const id2 = await badge.tokenIdOf(up2);
      expect(id1).to.not.equal(id2);
      expect(await badge.totalSupply()).to.equal(2n);
      expect(await badge.tokenOwnerOf(id1)).to.equal(up1);
      expect(await badge.tokenOwnerOf(id2)).to.equal(up2);
      expect(await badge.tokenIdsOf(up1)).to.deep.equal([id1]);
      expect(await badge.tokenIdsOf(up2)).to.deep.equal([id2]);
      // the tokenId decodes back to the UP address
      expect(ethers.getAddress(ethers.dataSlice(id2, 12))).to.equal(up2);
    });

    it("renews in place without minting a second token", async function () {
      const { badge, holderUp, attester, expiry } = await loadFixture(deployFixture);
      const up = await holderUp.getAddress();
      await badge.connect(attester).attest(up, CIE, await expiry());
      const newExp = await expiry(9 * YEAR);
      await badge.connect(attester).attest(up, CIE, newExp);
      expect(await badge.balanceOf(up)).to.equal(1n);
      expect(await badge.totalSupply()).to.equal(1n);
      expect((await badge.getAttestation(up)).expiresAt).to.equal(newExp);
    });
  });

  describe("isVerified", function () {
    it("is false before attestation and after expiry", async function () {
      const { badge, holderUp, attester, expiry } = await loadFixture(deployFixture);
      const up = await holderUp.getAddress();
      expect(await badge.isVerified(up)).to.equal(false);
      await badge.connect(attester).attest(up, CIE, await expiry(1000));
      expect(await badge.isVerified(up)).to.equal(true);
      await time.increase(1001);
      expect(await badge.isVerified(up)).to.equal(false);
      // an expired badge can be renewed
      await badge.connect(attester).attest(up, CIE, await expiry());
      expect(await badge.isVerified(up)).to.equal(true);
    });
  });

  describe("invalidate / renounce", function () {
    it("the attester invalidates; the badge can be attested again", async function () {
      const { badge, holderUp, attester, expiry } = await loadFixture(deployFixture);
      const up = await holderUp.getAddress();
      await badge.connect(attester).attest(up, CIE, await expiry());
      await expect(badge.connect(attester).invalidate(up, reason("CERT_REVOKED")))
        .to.emit(badge, "Invalidated")
        .withArgs(up, await badge.tokenIdOf(up), reason("CERT_REVOKED"), attester.address);
      expect(await badge.isVerified(up)).to.equal(false);
      expect((await badge.getAttestation(up)).status).to.equal(Status.Invalidated);
      // the token stays with the UP (no burn)
      expect(await badge.balanceOf(up)).to.equal(1n);
      await badge.connect(attester).attest(up, CIE, await expiry());
      expect(await badge.isVerified(up)).to.equal(true);
    });

    it("reverts when the badge is not valid or the caller is not the attester", async function () {
      const { badge, holderUp, attester, other } = await loadFixture(deployFixture);
      const up = await holderUp.getAddress();
      await expect(badge.connect(attester).invalidate(up, reason("X"))).to.be.revertedWithCustomError(badge, "BadgeNotValid");
      await expect(badge.connect(other).invalidate(up, reason("X"))).to.be.revertedWithCustomError(badge, "NotAttester");
    });

    it("the holder UP renounces its own badge", async function () {
      const { badge, holderUp, attester, asHolder, expiry } = await loadFixture(deployFixture);
      const up = await holderUp.getAddress();
      await badge.connect(attester).attest(up, CIE, await expiry());
      await expect(asHolder("renounce", []))
        .to.emit(badge, "Invalidated")
        .withArgs(up, await badge.tokenIdOf(up), reason("SELF"), up);
      expect(await badge.isVerified(up)).to.equal(false);
    });

    it("renounce reverts for an address without a valid badge", async function () {
      const { badge, other } = await loadFixture(deployFixture);
      await expect(badge.connect(other).renounce()).to.be.revertedWithCustomError(badge, "BadgeNotValid");
    });
  });

  describe("revoke / reinstate (owner)", function () {
    it("revoked badges cannot be renewed until reinstated", async function () {
      const { badge, holderUp, attester, asOwner, expiry } = await loadFixture(deployFixture);
      const up = await holderUp.getAddress();
      await badge.connect(attester).attest(up, CIE, await expiry());
      await expect(asOwner("revoke", [up, reason("ABUSE")]))
        .to.emit(badge, "Revoked")
        .withArgs(up, await badge.tokenIdOf(up), reason("ABUSE"));
      expect(await badge.isVerified(up)).to.equal(false);
      await expect(badge.connect(attester).attest(up, CIE, await expiry())).to.be.revertedWithCustomError(badge, "BadgeRevoked");
      await expect(badge.connect(attester).invalidate(up, reason("X"))).to.be.revertedWithCustomError(badge, "BadgeNotValid");

      await expect(asOwner("reinstate", [up])).to.emit(badge, "Reinstated");
      expect((await badge.getAttestation(up)).status).to.equal(Status.Invalidated);
      await badge.connect(attester).attest(up, CIE, await expiry());
      expect(await badge.isVerified(up)).to.equal(true);
    });

    it("revoke/reinstate edge cases", async function () {
      const { badge, holderUp, attester, asOwner, expiry } = await loadFixture(deployFixture);
      const up = await holderUp.getAddress();
      await expect(asOwner("revoke", [up, reason("X")])).to.be.revertedWithCustomError(badge, "BadgeNotFound");
      await expect(asOwner("reinstate", [up])).to.be.revertedWithCustomError(badge, "BadgeNotRevoked");
      await badge.connect(attester).attest(up, CIE, await expiry());
      await asOwner("revoke", [up, reason("X")]);
      await expect(asOwner("revoke", [up, reason("X")])).to.be.revertedWithCustomError(badge, "BadgeRevoked");
    });

    it("owner-only functions revert for other callers, including the attester", async function () {
      const { badge, holderUp, attester, other } = await loadFixture(deployFixture);
      const up = await holderUp.getAddress();
      for (const signer of [attester, other]) {
        await expect(badge.connect(signer).revoke(up, reason("X"))).to.be.revertedWith("Ownable: caller is not the owner");
        await expect(badge.connect(signer).reinstate(up)).to.be.revertedWith("Ownable: caller is not the owner");
        await expect(badge.connect(signer).setAttester(signer.address)).to.be.revertedWith("Ownable: caller is not the owner");
        await expect(badge.connect(signer).approveException(ethers.id("t"), 2)).to.be.revertedWith("Ownable: caller is not the owner");
      }
    });
  });

  describe("attester management", function () {
    it("the owner replaces the attester; the old one loses its rights", async function () {
      const { badge, holderUp, attester, other, asOwner, expiry } = await loadFixture(deployFixture);
      await expect(asOwner("setAttester", [other.address]))
        .to.emit(badge, "AttesterChanged")
        .withArgs(attester.address, other.address);
      const up = await holderUp.getAddress();
      await expect(badge.connect(attester).attest(up, CIE, await expiry())).to.be.revertedWithCustomError(badge, "NotAttester");
      await badge.connect(other).attest(up, CIE, await expiry());
      expect(await badge.isVerified(up)).to.equal(true);
    });

    it("setting the attester to zero stops all attestations (emergency stop)", async function () {
      const { badge, holderUp, attester, asOwner, expiry } = await loadFixture(deployFixture);
      await asOwner("setAttester", [ethers.ZeroAddress]);
      await expect(badge.connect(attester).attest(await holderUp.getAddress(), CIE, await expiry())).to.be.revertedWithCustomError(
        badge,
        "NotAttester",
      );
    });
  });

  describe("exceptions to one person = one UP", function () {
    it("the owner records an exception with an opaque ticket", async function () {
      const { badge, asOwner } = await loadFixture(deployFixture);
      const ticket = ethers.hexlify(ethers.randomBytes(32));
      await expect(asOwner("approveException", [ticket, 3])).to.emit(badge, "ExceptionApproved").withArgs(ticket, 3);
      expect(await badge.exceptionOf(ticket)).to.equal(3n);
    });

    it("rejects an empty ticket or a limit below 2", async function () {
      const { badge, asOwner } = await loadFixture(deployFixture);
      await expect(asOwner("approveException", [ethers.ZeroHash, 2])).to.be.revertedWithCustomError(badge, "InvalidException");
      await expect(asOwner("approveException", [ethers.id("t"), 1])).to.be.revertedWithCustomError(badge, "InvalidException");
    });
  });

  describe("soulbound", function () {
    it("blocks transfers, forced transfers and operators", async function () {
      const { badge, holderUp, holderUp2, attester, asHolder, expiry } = await loadFixture(deployFixture);
      const up = await holderUp.getAddress();
      const up2 = await holderUp2.getAddress();
      await badge.connect(attester).attest(up, CIE, await expiry());
      const tokenId = await badge.tokenIdOf(up);
      for (const force of [false, true]) {
        await expect(asHolder("transfer", [up, up2, tokenId, force, "0x"])).to.be.revertedWithCustomError(badge, "TransferNotAllowed");
      }
      await expect(asHolder("authorizeOperator", [up2, tokenId, "0x"])).to.be.revertedWithCustomError(badge, "OperatorsNotAllowed");
      expect(await badge.tokenOwnerOf(tokenId)).to.equal(up);
    });

    it("cannot transfer through batchCalls either", async function () {
      const { badge, holderUp, holderUp2, attester, asHolder, expiry } = await loadFixture(deployFixture);
      const up = await holderUp.getAddress();
      await badge.connect(attester).attest(up, CIE, await expiry());
      const call = badge.interface.encodeFunctionData("transfer", [up, await holderUp2.getAddress(), await badge.tokenIdOf(up), true, "0x"]);
      await expect(asHolder("batchCalls", [[call]])).to.be.revertedWithCustomError(badge, "TransferNotAllowed");
    });
  });
});
