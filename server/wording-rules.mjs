export const cp = (...codes) => String.fromCodePoint(...codes);
export const APOSTROPHES = "'" + cp(0x2019);
export const BANNED = [
  [/\bdelv(?:e|es|ed|ing)\b/i, 'delve'],
  [/\bseamless(?:ly)?\b/i, 'seamless'],
  [/\brobust(?:ly|ness)?\b/i, 'robust'],
  [/\bleverag(?:e|es|ed|ing)\b/i, 'leverage'],
  [/\butili[sz](?:e|es|ed|ing|ation)\b/i, 'utilize'],
  [/\bcomprehensive(?:ly)?\b/i, 'comprehensive'],
  [/\bcutting[\s-]edge\b/i, 'cutting-edge'],
  [/\bempower(?:s|ed|ing|ment)?\b/i, 'empower'],
  [/\bunlock(?:s|ed|ing)?\b/i, 'unlock'],
  [/\belevat(?:e|es|ed|ing)\b/i, 'elevate'],
  [/\bharness(?:es|ed|ing)?\b/i, 'harness'],
  [/\bstreamlin(?:e|es|ed|ing)\b/i, 'streamline'],
  [/\brevolutioni[sz](?:e|es|ed|ing)\b/i, 'revolutionize'],
  [/\bgame[\s-]?changer?s?\b/i, 'game-changer'],
  [/\bai[\s-]powered\b/i, 'AI-powered'],
  [/\bsmart(?:er|est|ly)?\b/i, 'smart'],
  [new RegExp('\\bit(?:[' + APOSTROPHES + ']|\\s+i)s\\s+worth\\s+noting\\b', 'i'), "it's worth noting"],
  [new RegExp('\\blet[' + APOSTROPHES + ']s\\s+dive\\s+in\\b', 'i'), "let's dive in"],
];
export const EMOJI = new RegExp('(?![' + cp(0xa9, 0xae, 0x2122) + '])\\p{Extended_Pictographic}|' + cp(0xfe0f) + '|' + cp(0x200d) + '(?=\\p{Extended_Pictographic})', 'u');
export const EM_DASH = cp(0x2014);
