# English Reader Lexicon Attribution

This notice applies to the versioned lexicon data assets in this directory. It
does not replace the application source license. Exact immutable source URLs,
versions, checksums, retrieval dates, and source-license links are recorded in
`lexicon-manifest.json`.

## CC BY-SA derived layers

`lexicon-core.json` is a combined learning-data artifact. The portions derived
from the following lists are **Adapted Material** and are offered under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/):

- **New General Service List 1.2** — Charles Browne, Brent Culligan, and Joseph
  Phillips. The NGSL-derived frequency layer is used under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **New Academic Word List 1.2** — Charles Browne, Brent Culligan, and Joseph
  Phillips. The NAWL-derived academic membership and inflection layer is used
  under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **wordfreq 3.2.0** — Robyn Speer. The derived lookup-frequency layer uses
  the pinned `large_en.msgpack.gz` English data under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Retain the
  `wordfreq` source notices, including attribution to Robyn Speer, when
  redistributing the derived layer.

**Changes:** English Reader normalizes single-token lemmas; maps NGSL rank to
six frequency bands; records NAWL membership; excludes NAWL comma-separated
observations from default forms; decodes the fixed wordfreq cBpack snapshot and
retains only its first 25,000 normalized single-token candidates as a
lookup-frequency layer; merges only the declared layers; and adds only the
separately documented conservative inflections. It does not redistribute the
source CSV or cBpack files. The original authors, source identification,
license notice, source URI, and this change notice must be retained when these
derived layers are shared.

## Other active source

- **ECDICT** — Linwei, [MIT License](https://raw.githubusercontent.com/skywind3000/ECDICT/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/LICENSE).
  The app ships only manually reviewed `high` senses and compact automatically
  screened `screened` Chinese learning senses for declared candidates, not the
  original full database. The exact pinned input and checksum are in
  `lexicon-manifest.json`.

## Not shipped in the current core

- **CEFR-J Vocabulary Profile 1.5** — compiled by Yukio Tono at Tokyo
  University of Foreign Studies. The pinned terms permit research and
  commercial use with citation, but do not expressly grant redistribution or a
  derived CEFR layer in the APK. It is therefore `reserved-not-core`; no
  CEFR-J record or CEFR-J-derived layer is shipped in `lexicon-core.json`.
- **Open English WordNet** — Open English WordNet Community, derived from
  Princeton WordNet, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  The independent `oewn-core-2025.json` derivative is separately attributed in
  `oewn-artifact-manifest.json`. The partial OEWN YAML snapshots in
  `lexicon-manifest.json` remain `reserved-not-core` and do not affect the
  current core.

The complete machine-readable records are `lexicon-manifest.json` for the
coverage/difficulty core and `oewn-artifact-manifest.json` for the independent
English-definition derivative.
