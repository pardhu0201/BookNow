'use strict';

// RFC 4180 quoting, plus a leading apostrophe on cells a spreadsheet would
// run as a formula (=, +, -, @), so an attendee email cannot inject one.
function cell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header, rows) {
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\n') + '\n';
}

module.exports = { toCsv };
