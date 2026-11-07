// The looks (renderer/themes.js), written out for the plugin's tests to check its Theme.cs has the same colours:
//
//   node tests/themes-fixture.js ../XIVFleetCompanion/tests/FleetWriterTests/themes-fixture.json
const fs = require('fs');
const { THEMES } = require('../renderer/themes');

const out = process.argv[2];
const json = `${JSON.stringify({ about: 'Written by XIVFleetCompanion-App tests/themes-fixture.js: every look\'s colours.', themes: THEMES })}\n`;
if (out) fs.writeFileSync(out, json);
console.log(`${THEMES.length} looks${out ? `, written to ${out}` : ''}`);
