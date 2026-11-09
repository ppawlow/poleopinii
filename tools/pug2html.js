const pug = require("pug");
const path = require("path");

const pug2html = {};
module.exports = pug2html;

const MAILS = "../views/mails";
const MESSAGES = "../views/messages";
const PARTIALS = "../views/partials";

pug2html.render = function(templateDir, templateName, locals) {
  try {
    const filePath = path.join(__dirname, templateDir, `${templateName}.pug`);
    return pug.renderFile(filePath, locals);
  } catch (err) {
    console.error(`[PUG2HTML CRITICAL ERROR] Błąd renderowania szablonu ${templateName}:`, err);
    // Bezpieczny fallback tekstowy, aby aplikacja nie uległa awarii
    return `<div style="color:#bc2525; padding:10px;">⚠️ Błąd przetwarzania komponentu wizualnego systemu (${templateName}).</div>`;
  }
}

pug2html.renderMail = function(templateName, locals){
    return pug2html.render(MAILS, templateName, locals)
}

pug2html.renderMessage = function(templateName, locals){
    return pug2html.render(MESSAGES, templateName, locals)
}

pug2html.renderPartial = function(templateName, locals){
    return pug2html.render(PARTIALS, templateName, locals)
}
