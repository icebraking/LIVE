const fs = require('fs');
const path = require('path');

const races = {
    "aus": "australia.html",
    "chn": "china.html",
    "jpn": "japan.html",
    "bah": "bahrain.html",
    "sar": "saudi.html",
    "mim": "miami.html",
    "ity_imola": "imola.html",
    "mon": "monaco.html",
    "can": "canada.html",
    "cat": "spain.html",
    "atr": "austria.html",
    "eng": "uk.html",
    "hun": "hungary.html",
    "bel": "belgium.html",
    "nel": "netherlands.html",
    "ity": "italy.html",
    "abn": "azerbaijan.html",
    "sgp": "singapore.html",
    "aut": "usa.html",
    "mex": "mexico.html",
    "brl": "brazil.html",
    "veg": "lasvegas.html",
    "qtr": "qatar.html",
    "uae": "abudhabi.html"
};

const templatePath = path.join(__dirname, 'race-template.html');
const template = fs.readFileSync(templatePath, 'utf8');

for (const [key, filename] of Object.entries(races)) {
    // Specifically matching the exact template comment
    const customized = template.replace(
        '// REPLACE_ME',
        `const currentRace = "${key}";\n        fetchOpenF1Data("${key}");`
    );
    const filePath = path.join(__dirname, filename);
    fs.writeFileSync(filePath, customized);
    console.log('Created ' + filename);
}
