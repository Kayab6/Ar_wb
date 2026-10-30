import { parseFile, remapResult } from "./csv-engine.js?v=3";
import { DEFAULT_CONFIG, buildLeaderboard } from "./scoring-engine.js?v=3";
import { buildLeaderboardCsv, buildCompleteResultsCsv, downloadCsv, generatePdf } from "./report-engine.js?v=3";

const uploads = document.querySelector("#roundUploads");
const results = document.querySelector("#results");
const rounds = new Map();
const fileOwners = new Map();
const config = structuredClone(DEFAULT_CONFIG);
const leaderboard = document.querySelector("#leaderboard");
const teamDetails = document.querySelector("#teamDetails");

for (let round = 1; round <= 4; round += 1) {
  document.querySelector("#roundConfig").insertAdjacentHTML("beforeend", `<label>Round ${round} max<input type="number" min="0" step="any" data-config="maximums" data-round="${round}" placeholder="Optional"></label><label>Weight<input type="number" min="0" step="any" data-config="weights" data-round="${round}" value="1"></label>`);
}
document.querySelector(".config-card").addEventListener("input", updateConfig);
document.querySelector(".config-card").addEventListener("change", updateConfig);
document.querySelector("#downloadLeaderboard").addEventListener("click", () => exportCurrent("leaderboard"));
document.querySelector("#downloadComplete").addEventListener("click", () => exportCurrent("complete"));
document.querySelector("#downloadPdf").addEventListener("click", () => {
  const teams = buildLeaderboard(rounds, config);
  if (config.method !== "normalized" || !config.confirmed || [1, 2, 3, 4].some((round) => Number(config.maximums[round]) <= 0)) {
    setConfigMessage("Confirm normalized scoring and enter a positive maximum for every round before generating the final PDF.", "error");
    return;
  }
  try { generatePdf(teams, config, document.querySelector("#eventTitle").value.trim() || "Competition Results"); }
  catch (error) { setConfigMessage(error.message, "error"); }
});

for (let round = 1; round <= 4; round += 1) {
  const card = document.createElement("article");
  card.className = "upload-card";
  card.innerHTML = `<h2>Round ${round}</h2><input type="file" accept=".csv,text/csv" aria-label="Upload Round ${round} CSV"><div class="file-name">No file selected</div><div class="status" role="status">Waiting for upload</div>`;
  const input = card.querySelector("input");
  input.addEventListener("change", () => handleUpload(round, input, card));
  uploads.append(card);
}

async function handleUpload(round, input, card) {
  const file = input.files[0];
  const status = card.querySelector(".status");
  const name = card.querySelector(".file-name");
  if (!file) return;
  if (fileOwners.has(file) && fileOwners.get(file) !== round) {
    input.value = "";
    status.className = "status error";
    status.textContent = "This file is already assigned to another round.";
    return;
  }
  status.className = "status";
  status.textContent = "Reading and validating…";
  name.textContent = file.name;
  try {
    const result = await parseFile(file, round);
    const previous = rounds.get(round);
    if (previous) fileOwners.delete(previous.file);
    result.file = file;
    fileOwners.set(file, round);
    rounds.set(round, result);
    status.className = `status ${result.invalidRecords ? "warning" : "success"}`;
    status.textContent = result.invalidRecords ? "Processed with validation issues" : "Processed successfully";
    renderResults();
  } catch (error) {
    status.className = "status error";
    status.textContent = error.message;
  }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function renderResults() {
  if (!rounds.size) return;
  results.innerHTML = [...rounds.values()].sort((a, b) => a.round - b.round).map(renderResult).join("");
  renderLeaderboard();
}

function renderResult(result) {
  const mapping = ["teamId", "teamName", "score", "time"].map((field) => `<span class="${result.mapping[field] ? "" : "missing"}">${field}: ${esc(result.mapping[field] || "not mapped")}</span>`).join("");
  const mappingForm = renderMappingForm(result);
  const issues = result.issues.length ? `<div class="issues"><h3>Validation issues</h3><ul>${result.issues.map((item) => `<li class="issue-${item.severity}">${item.row ? `Row ${item.row}: ` : ""}${esc(item.message)}</li>`).join("")}</ul></div>` : `<p class="success-text">No validation issues.</p>`;
  const rows = result.records.map((record) => `<tr><td>${esc(record.teamId || "—")}</td><td>${esc(record.teamName || "—")}</td><td>${record.score ?? "—"}</td><td>${record.time ?? "—"}</td><td><span class="badge ${record.rowIssues.length ? "invalid" : "valid"}">${record.rowIssues.length ? esc(record.rowIssues.join(" ")) : "Valid"}</span></td></tr>`).join("");
  return `<article class="result-card"><div class="result-heading"><div><h2>Round ${result.round}</h2><p>${esc(result.fileName)}</p></div><strong>${result.headers.length} columns detected</strong></div><div class="metrics"><div class="metric"><strong>${result.totalRows}</strong><span>Total rows</span></div><div class="metric"><strong>${result.validRecords}</strong><span>Valid records</span></div><div class="metric"><strong>${result.invalidRecords}</strong><span>Invalid records</span></div><div class="metric"><strong>${result.duplicateIds.length}</strong><span>Duplicate IDs</span></div></div><div class="mapping">${mapping}</div>${mappingForm}${issues}<div class="table-wrap"><table><thead><tr><th>Team ID</th><th>Team Name</th><th>Score</th><th>Time</th><th>Status</th></tr></thead><tbody>${rows || `<tr><td colspan="5">No records to preview.</td></tr>`}</tbody></table></div><details><summary>View original parsed rows</summary><pre>${esc(JSON.stringify(result.originalRows, null, 2))}</pre></details></article>`;
}

function renderMappingForm(result) {
  const needsMapping = result.detection.ambiguous.length || ["teamId", "teamName", "score", "time"].some((field) => !result.mapping[field]);
  if (!needsMapping) return "";
  const fields = ["teamId", "teamName", "score", "time"];
  const options = (field) => `<option value="">Not present</option>${result.headers.map((header) => `<option value="${esc(header)}" ${result.mapping[field] === header ? "selected" : ""}>${esc(header)}</option>`).join("")}`;
  return `<details open><summary>Manual column mapping required</summary><form class="mapping-form" data-round="${result.round}">${fields.map((field) => `<label>${field}<select name="${field}">${options(field)}</select></label>`).join("")}<button type="submit">Apply mapping</button></form></details>`;
}

results.addEventListener("submit", (event) => {
  const form = event.target.closest(".mapping-form");
  if (!form) return;
  event.preventDefault();
  const round = Number(form.dataset.round);
  const current = rounds.get(round);
  const selectedMapping = Object.fromEntries([...new FormData(form)].filter(([, value]) => value).map(([field, value]) => [field, value]));
  const updated = remapResult(current, selectedMapping);
  updated.file = current.file;
  rounds.set(round, updated);
  renderResults();
});

function updateConfig() {
  config.method = document.querySelector("#method").value;
  config.timeTieBreaker = document.querySelector("#timeTieBreaker").value;
  config.timeMode = document.querySelector("#timeMode").value;
  config.confirmed = document.querySelector("#confirmConfig").checked;
  document.querySelectorAll("[data-config]").forEach((input) => {
    config[input.dataset.config][input.dataset.round] = input.value;
  });
  setConfigMessage(config.confirmed ? `Confirmed: ${config.method} scoring` : "Configuration not confirmed; results remain provisional", config.confirmed ? "success" : "warning");
  renderLeaderboard();
}

function setConfigMessage(message, type) {
  const status = document.querySelector("#configStatus");
  status.className = `status ${type}`;
  status.textContent = message;
}

function exportCurrent(kind) {
  if (!rounds.size) {
    setConfigMessage("Upload and process at least one round before exporting.", "error");
    return;
  }
  const teams = buildLeaderboard(rounds, config);
  downloadCsv(kind === "leaderboard" ? buildLeaderboardCsv(teams) : buildCompleteResultsCsv(teams), `${kind}-results.csv`);
}

function renderLeaderboard() {
  if (!rounds.size) {
    leaderboard.innerHTML = "";
    teamDetails.innerHTML = "";
    return;
  }
  const teams = buildLeaderboard(rounds, config);
  leaderboard.innerHTML = `<article class="result-card"><div class="result-heading"><div><h2>Consolidated leaderboard</h2><p>Method: ${esc(config.method)}${config.confirmed ? " · Configuration confirmed" : " · Provisional configuration"}</p></div><strong>${teams.length} teams</strong></div><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Team ID</th><th>Team Name</th><th>R1</th><th>R2</th><th>R3</th><th>R4</th><th>Overall</th><th>Completed</th><th>Status</th></tr></thead><tbody>${teams.map(renderLeaderboardRow).join("")}</tbody></table></div></article>`;
  teamDetails.innerHTML = `<article class="result-card"><h2>Team performance details</h2><label>Select team<select id="teamSelect"><option value="">Choose a team</option>${teams.map((team) => `<option value="${esc(team.teamId)}">${esc(team.teamId)} — ${esc(team.teamName)}</option>`).join("")}</select></label><div id="selectedTeam"></div></article>`;
  document.querySelector("#teamSelect").addEventListener("change", (event) => renderTeamDetails(teams.find((team) => team.teamId === event.target.value)));
}

function renderLeaderboardRow(team) {
  const roundCell = (round) => {
    const value = team.roundValues[`round${round}`];
    return value.score ?? (value.time === null ? "—" : `${value.time} time`);
  };
  return `<tr><td>${team.rank ?? "—"}</td><td>${esc(team.teamId)}</td><td>${esc(team.teamName || "—")}</td><td>${roundCell(1)}</td><td>${roundCell(2)}</td><td>${roundCell(3)}</td><td>${roundCell(4)}</td><td>${team.overallScore === null ? "—" : team.overallScore.toFixed(2)}</td><td>${team.completedRounds}/4</td><td><span class="badge ${team.status === "Finalized" ? "valid" : "invalid"}">${team.status}</span></td></tr>`;
}

function renderTeamDetails(team) {
  const target = document.querySelector("#selectedTeam");
  if (!team) {
    target.innerHTML = "";
    return;
  }
  target.innerHTML = `<div class="detail-grid"><p><strong>Team ID</strong>${esc(team.teamId)}</p><p><strong>Team Name</strong>${esc(team.teamName || "—")}</p><p><strong>Rank</strong>${team.rank ?? "Unranked"}</p><p><strong>Overall</strong>${team.overallScore === null ? "Unavailable" : team.overallScore.toFixed(2)}</p><p><strong>Completed rounds</strong>${team.completedRounds}/4</p><p><strong>Missing rounds</strong>${team.missingRounds.length ? team.missingRounds.join(", ") : "None"}</p></div><div class="table-wrap"><table><thead><tr><th>Round</th><th>Score</th><th>Time</th><th>Source row</th></tr></thead><tbody>${[1, 2, 3, 4].map((round) => { const value = team.roundValues[`round${round}`]; return `<tr><td>Round ${round}</td><td>${value.score ?? "—"}</td><td>${value.time ?? "—"}</td><td>${value.sourceRow ?? "—"}</td></tr>`; }).join("")}</tbody></table></div><p class="${team.issues.length ? "error-text" : "success-text"}">${team.issues.length ? esc(team.issues.join(" ")) : `Status: ${team.status}`}</p>`;
}
