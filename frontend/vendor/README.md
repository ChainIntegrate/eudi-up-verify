# Third-party code (UP Wallet for Android only)

These files are the only third-party code of the site. They are loaded **only** when a person chooses
"UP Wallet for Android" (or a UP Wallet session was kept in the browser), always with Subresource Integrity
(`js/wc.js`). They are the same files, byte for byte, as in
[Cross_Chain's `vendor/`](https://github.com/ChainIntegrate/Cross_Chain/tree/main/vendor), where the rebuild steps are.

| File | What | License |
|---|---|---|
| `signclient-2.25.0.min.js` | WalletConnect client, dApp side: `@walletconnect/sign-client`, `core`, `types`, `utils` 2.25.0 bundled with esbuild 0.28.2. SHA-256 `3bc27e35fce1194c0a454f6ef07d210b8718152e23c76fcbfa6546a1b9d673c8` | Reown packages: **WalletConnect Community License Agreement** (not open source), text in `WALLETCONNECT-LICENSE.md`; the other 38 packages (MIT, ISC, 0BSD, Apache-2.0) are listed in `signclient-2.25.0.THIRD-PARTY.txt` |
| `qrcode-generator-1.4.4.js` | QR code of the pairing link, by Kazuhiko Arase, unchanged. SHA-256 `18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780` | MIT (notice in the file). "QR Code" is a registered trademark of DENSO WAVE INCORPORATED |

The WalletConnect license requires the notice "Portions © 2025 Reown, Inc. All Rights Reserved" (shown in the
connection window, the only place the client is used) and the use of Reown's relay; above its thresholds (currently
500 monthly active users or 2,500,000 monthly RPC calls) a paid commercial license is needed. The Reown project ID
(public) is `WALLETCONNECT_PROJECT_ID` in `backend/.env`; its protection is the project's allowed domains on
cloud.reown.com, which must include this site. Usage telemetry is off (`telemetryEnabled: false` and the SDK's event
client muted, as in Cross_Chain).

When the version changes: take the new files from Cross_Chain, update the `integrity` values in `js/wc.js`
(`openssl dgst -sha384 -binary <file> | openssl base64 -A`), this table and the license files.
