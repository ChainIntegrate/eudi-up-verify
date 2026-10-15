// Birth date and age from an Italian tax code (codice fiscale), used only in memory for the age check (UCL-11).
// Layout: SSSNNN YY M DD CCCC K. Omocodia replaces digits with letters (L M N P Q R S T U V = 0..9);
// month letters A B C D E H L M P R S T = 1..12; women have day + 40.
// The two-digit year is resolved to the most recent past century (a person over 100 would be read as a child:
// accepted limitation, they get a neutral refusal).

const OMOCODIA = "LMNPQRSTUV";
const MONTHS = "ABCDEHLMPRST";
const digit = (c) => (c >= "0" && c <= "9" ? Number(c) : OMOCODIA.indexOf(c));

/** @returns {Date|null} birth date (UTC), or null when the code cannot be read */
export function birthDate(taxCode, now = new Date()) {
  if (typeof taxCode !== "string" || taxCode.length !== 16) return null;
  const cf = taxCode.toUpperCase();
  const yy = digit(cf[6]) * 10 + digit(cf[7]);
  const month = MONTHS.indexOf(cf[8]);
  let day = digit(cf[9]) * 10 + digit(cf[10]);
  if ([digit(cf[6]), digit(cf[7]), digit(cf[9]), digit(cf[10])].some((d) => d < 0) || month < 0) return null;
  if (day > 40) day -= 40;
  if (day < 1 || day > 31) return null;
  let year = 2000 + yy;
  if (Date.UTC(year, month, day) > now.getTime()) year -= 100;
  const d = new Date(Date.UTC(year, month, day));
  return d.getUTCMonth() === month ? d : null; // rejects e.g. 31 February
}

/** True if the holder is at least `minAge` years old at `now`. */
export function isAtLeast(taxCode, minAge, now = new Date()) {
  const b = birthDate(taxCode, now);
  if (!b) return false;
  const limit = Date.UTC(b.getUTCFullYear() + minAge, b.getUTCMonth(), b.getUTCDate());
  return now.getTime() >= limit;
}
