

import fs from 'fs';

//TODO read the package.json to get the version, and update the value in web/version.js
const packageJsonPath =  './package.json';

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version || "1.0.0";

// Update the web/version.js file with the new version
const versionFilePath = './web/version.js';

const versionFileContent = fs.readFileSync(versionFilePath, 'utf8');
//TODO, find line with "AUTO Generated Version", and delete that line, and insert new version line
const newVersionLine = `let version = "v${version}"; //AUTO Generated Version - do not edit manually`;
const updatedContent = versionFileContent.replace(/let version = "v[0-9\.]+"; \/\/AUTO Generated Version - do not edit manually/, newVersionLine);

fs.writeFileSync(versionFilePath, updatedContent, 'utf8');
