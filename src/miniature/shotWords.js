/**
 * The short words for a shot, where there is no room for its full title: the peek line and
 * the shot cards. Pure, no DOM.
 */

/** "Karl-Marx-Straße" as Berlin's own street signs shorten it: "Karl-Marx-Str.". */
export const shortStreet = (name) => String(name).replace(/([Ss])traße(?![a-zäöüß])/g, '$1tr.');

const SUFFIX = /(?<=[a-zäöüß]{3})(straße|str\.|damm|allee|platz|brücke|chaussee|graben|markt|promenade|ufer|ring|weg)(?![a-zäöüß])/g;
/**
 * The name with soft hyphens where a German street name may break ("Hohenzollern-damm"), so
 * a narrow card wraps it at a joint. The browser's own hyphenation, where it has one, adds more.
 */
export const breakable = (name) => String(name).replace(SUFFIX, '­$1');

/**
 * The peek line's wordings for one shot, fullest first; the line takes the first that fits.
 * `brief` is the shot in a few words ("Sun down Hohenzollerndamm"), `compact` the same with
 * no verb ("Sun · Hohenzollerndamm"), `short` only its place;
 * `when` and `whenShort` its time with the day ("Tomorrow 07:12", "Wed 07:12"); `wait` the
 * countdown. The time and the verdict are in every wording: only the countdown and the
 * length of the name give way.
 */
export function peekVariants({ brief, compact = brief, short, when, whenShort = when, wait = '' }) {
  const list = [
    { when, what: brief, wait },
    { when, what: brief, wait: '' },
    { when, what: shortStreet(brief), wait: '' },
    { when: whenShort, what: shortStreet(brief), wait: '' },
    { when: whenShort, what: shortStreet(compact), wait: '' },
    { when: whenShort, what: shortStreet(short), wait: '' },
  ];
  return list.filter((v, i) => i === 0 || JSON.stringify(v) !== JSON.stringify(list[i - 1]));
}
