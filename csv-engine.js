const FIELD_ALIASES = {
  teamId: ["team id", "teamid", "team code", "team number", "group id", "id"],
  teamName: ["team name", "team", "group name", "group"],
  score: ["score", "marks", "points", "total score", "total marks", "obtained marks"],
  time: ["time", "completion time", "duration", "elapsed time", "time taken", "total time"]
};

const REQUIRED_FIELDS = ["teamId", "teamName"];
const OPTIONAL_FIELDS = ["score", "time"];

export function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function detectColumns(headers) {
  const mapping = {};
  const ambiguous = [];
  const unrecognized = [];
  for (const field of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
    const matches = headers.filter((header) => FIELD_ALIASES[field].includes(normalizeHeader(header)));
    if (matches.length === 1) mapping[field] = matches[0];
    else if (matches.length > 1) ambiguous.push({ field, candidates: matches });
  }
  for (const header of headers) {
    if (!Object.values(mapping).includes(header) && !Object.values(ambiguous).some((item) => item.candidates.includes(header))) {
      unrecognized.push(header);
    }
  }
  return { mapping, ambiguous, unrecognized };
}

function issue(row, severity, message) {
  return { row, severity, message };
}

function parseNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const normalized = String(value).trim().replace(/,/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

function standardizeTeamId(value) {
  const trimmed = String(value ?? "").trim().toUpperCase();
  const match = /^LT-(\d+)$/.exec(trimmed);
  return match ? `LT-${match[1].padStart(3, "0")}` : null;
}

export function processCsv(parsed, round, fileName, selectedMapping = {}) {
  const headers = parsed.meta?.fields ?? [];
  const detection = detectColumns(headers);
  const mapping = { ...detection.mapping, ...selectedMapping };
  const issues = [];
  const records = [];
  const seenIds = new Map();
  const rows = Array.isArray(parsed.data) ? parsed.data : [];
  if (!headers.length) issues.push(issue(null, "error", "No header row was detected."));
  if (!rows.length) issues.push(issue(null, "error", "The CSV contains no data rows."));
  for (const field of REQUIRED_FIELDS) {
    if (!mapping[field]) issues.push(issue(null, "error", `No ${field === "teamId" ? "Team ID" : "Team Name"} column is mapped.`));
  }
  if (detection.ambiguous.length) {
    for (const item of detection.ambiguous) {
      if (!mapping[item.field]) issues.push(issue(null, "error", `Ambiguous ${item.field} column: ${item.candidates.join(", ")}. Choose one manually.`));
    }
  }
  if (parsed.errors?.length) {
    for (const error of parsed.errors) issues.push(issue(error.row ? error.row + 1 : null, "error", `Malformed CSV: ${error.message}`));
  }

  rows.forEach((source, index) => {
    const sourceRow = index + 2;
    const values = headers.map((header) => source[header]);
    if (values.every((value) => String(value ?? "").trim() === "")) {
      issues.push(issue(sourceRow, "warning", "Empty row."));
      return;
    }
    const rowIssues = [];
    const rawId = mapping.teamId ? source[mapping.teamId] : "";
    const teamId = standardizeTeamId(rawId);
    const teamName = mapping.teamName ? String(source[mapping.teamName] ?? "").trim() : "";
    if (!String(rawId ?? "").trim()) rowIssues.push("Missing Team ID.");
    else if (!teamId) rowIssues.push("Invalid Team ID; expected LT-001 format.");
    if (!teamName) rowIssues.push("Missing Team Name.");
    const score = mapping.score ? parseNumber(source[mapping.score]) : null;
    const time = mapping.time ? parseNumber(source[mapping.time]) : null;
    if (mapping.score && !String(source[mapping.score] ?? "").trim()) rowIssues.push("Missing score.");
    if (mapping.time && !String(source[mapping.time] ?? "").trim()) rowIssues.push("Missing time.");
    if (mapping.score && score === undefined) rowIssues.push("Invalid numerical score.");
    if (mapping.time && time === undefined) rowIssues.push("Invalid numerical time; original value is preserved below.");
    if (typeof score === "number" && score < 0) rowIssues.push("Score cannot be negative.");
    if (typeof time === "number" && time < 0) rowIssues.push("Time cannot be negative.");
    if (teamId && seenIds.has(teamId)) {
      rowIssues.push(`Duplicate Team ID; first seen on row ${seenIds.get(teamId)}.`);
      issues.push(issue(sourceRow, "error", rowIssues[rowIssues.length - 1]));
    } else if (teamId) seenIds.set(teamId, sourceRow);
    const record = { teamId, teamName, round, score: score === undefined ? null : score, time: time === undefined ? null : time, sourceRow, original: source, rowIssues };
    records.push(record);
    rowIssues.filter((message) => !message.startsWith("Duplicate Team ID")).forEach((message) => issues.push(issue(sourceRow, "error", message)));
  });
  const invalidRecords = records.filter((record) => record.rowIssues.length);
  return {
    round, fileName, headers, originalRows: rows, records, issues, mapping,
    detection, totalRows: rows.length, validRecords: records.length - invalidRecords.length,
    invalidRecords: invalidRecords.length, duplicateIds: [...seenIds.keys()].filter((id) => records.filter((record) => record.teamId === id).length > 1)
  };
}

export function remapResult(result, selectedMapping) {
  return processCsv(
    { data: result.originalRows, errors: [], meta: { fields: result.headers } },
    result.round,
    result.fileName,
    selectedMapping
  );
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("Malformed CSV: an opening quote has no closing quote.");
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  const fields = rows.shift() || [];
  const data = [];
  const errors = [];
  rows.forEach((values, index) => {
    if (values.length !== fields.length) {
      errors.push({ row: index + 1, message: `Expected ${fields.length} columns but found ${values.length}.` });
    }
    const record = {};
    fields.forEach((field, fieldIndex) => { record[field] = values[fieldIndex] ?? ""; });
    data.push(record);
  });
  return { data, errors, meta: { fields } };
}

export function parseFile(file, round) {
  return new Promise((resolve, reject) => {
    if (!file || !/\.csv$/i.test(file.name)) {
      reject(new Error("Please select a .csv file."));
      return;
    }
    if (typeof Papa !== "undefined" && typeof Papa.parse === "function") {
      Papa.parse(file, {
        header: true, skipEmptyLines: false, dynamicTyping: false,
        complete: (parsed) => resolve(processCsv(parsed, round, file.name)),
        error: (error) => reject(new Error(`Unable to parse CSV: ${error.message || "unknown error"}`))
      });
      return;
    }
    file.text()
      .then((text) => resolve(processCsv(parseCsvText(text), round, file.name)))
      .catch((error) => reject(new Error(`Unable to read CSV: ${error.message || "unknown error"}`)));
  });
}
