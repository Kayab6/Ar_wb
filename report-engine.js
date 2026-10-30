function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function score(value) {
  return value === null || value === undefined ? "" : Number(value).toFixed(2);
}

export function buildLeaderboardCsv(teams) {
  const header = ["Rank", "Team ID", "Team Name", "Round 1", "Round 2", "Round 3", "Round 4", "Overall Score", "Completed Rounds", "Status"];
  const rows = teams.map((team) => [
    team.rank ?? "", team.teamId, team.teamName, ...[1, 2, 3, 4].map((round) => team.roundValues[`round${round}`].score ?? ""),
    score(team.overallScore), `${team.completedRounds}/4`, team.status
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function buildCompleteResultsCsv(teams) {
  const header = ["Team ID", "Team Name", "Rank", "Status", "Completed Rounds", "Missing Rounds", "Round 1 Score", "Round 1 Time", "Round 2 Score", "Round 2 Time", "Round 3 Score", "Round 3 Time", "Round 4 Score", "Round 4 Time", "Overall Score", "Issues"];
  const rows = teams.map((team) => [
    team.teamId, team.teamName, team.rank ?? "", team.status, `${team.completedRounds}/4`, team.missingRounds.join("|"),
    ...[1, 2, 3, 4].flatMap((round) => {
      const value = team.roundValues[`round${round}`];
      return [value.score ?? "", value.time ?? ""];
    }),
    score(team.overallScore), team.issues.join(" | ")
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function download(content, fileName, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

export function downloadCsv(content, fileName) {
  download(`\ufeff${content}`, fileName, "text/csv;charset=utf-8");
}

export function generatePdf(teams, config, title = "Competition Results") {
  if (!window.jspdf?.jsPDF) {
    throw new Error("PDF libraries are not available. Check your internet connection and reload the page.");
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const finalized = teams.filter((team) => team.status === "Finalized");
  const provisional = teams.filter((team) => team.status !== "Finalized");
  const date = new Date().toLocaleDateString();
  const addHeader = (text) => {
    doc.setFontSize(16);
    doc.setTextColor(49, 86, 211);
    doc.text(text, 14, 16);
    doc.setTextColor(23, 32, 51);
  };
  const addFooter = () => {
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      doc.setFontSize(8);
      doc.setTextColor(100, 112, 138);
      doc.text(`Page ${page} of ${pages}`, 283, 202, { align: "right" });
    }
  };

  doc.setFontSize(25);
  doc.text(title, 14, 40);
  doc.setFontSize(17);
  doc.text("Result Report", 14, 51);
  doc.setFontSize(11);
  doc.text(`Generated: ${date}`, 14, 65);
  doc.text(`Participating teams: ${teams.length}`, 14, 73);
  doc.text(`Finalized teams: ${finalized.length} | Provisional teams: ${provisional.length}`, 14, 81);
  doc.text("Official method: normalized average out of 100", 14, 89);

  doc.addPage();
  addHeader("Final Leaderboard");
  if (typeof doc.autoTable !== "function") throw new Error("PDF table library is not available. Check your internet connection and reload the page.");
  doc.autoTable({
    startY: 23,
    head: [["Rank", "Team ID", "Team Name", "R1", "R2", "R3", "R4", "Final / 100"]],
    body: finalized.map((team) => [team.rank, team.teamId, team.teamName, ...[1, 2, 3, 4].map((round) => score(team.roundValues[`round${round}`].score)), score(team.overallScore)]),
    styles: { fontSize: 8 }, headStyles: { fillColor: [49, 86, 211] }, theme: "grid"
  });
  if (provisional.length) {
    doc.setFontSize(12);
    doc.text("Provisional teams (not officially ranked)", 14, doc.lastAutoTable.finalY + 12);
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 16,
      head: [["Team ID", "Team Name", "Completed", "Missing rounds", "Overall", "Status"]],
      body: provisional.map((team) => [team.teamId, team.teamName, `${team.completedRounds}/4`, team.missingRounds.join(", ") || "Validation issue", score(team.overallScore), "PROVISIONAL"]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [154, 103, 0] }, theme: "grid"
    });
  }

  doc.addPage();
  addHeader("Round-wise Performance");
  doc.autoTable({
    startY: 23,
    head: [["Team ID", "Team Name", "R1 score / %", "R2 score / %", "R3 score / %", "R4 score / %", "Maximums", "Completed", "Status"]],
    body: teams.map((team) => [
      team.teamId, team.teamName || "—",
      ...[1, 2, 3, 4].map((round) => {
        const value = team.roundValues[`round${round}`];
        const maximum = Number(config.maximums?.[round]);
        const normalized = value.score !== null && maximum > 0 ? ` / ${(value.score / maximum * 100).toFixed(2)}` : "";
        return value.score === null ? (value.time === null ? "—" : `Time: ${value.time}`) : `${score(value.score)}${normalized}`;
      }),
      [1, 2, 3, 4].map((round) => config.maximums?.[round] || "—").join(" / "),
      `${team.completedRounds}/4`, team.status
    ]),
    styles: { fontSize: 8 }, headStyles: { fillColor: [49, 86, 211] }, theme: "grid"
  });

  doc.addPage();
  addHeader("Team Performance Details");
  for (const team of teams) {
    doc.setFontSize(10);
    doc.text(`${team.teamId} — ${team.teamName || "Unnamed"} | Rank: ${team.rank ?? "Unranked"} | Overall: ${score(team.overallScore)} | ${team.status}`, 14, 24);
    doc.autoTable({
      startY: 28,
      head: [["Round", "Score", "Time", "Normalized score", "Completion"]],
      body: [1, 2, 3, 4].map((round) => {
        const value = team.roundValues[`round${round}`];
        const maximum = Number(config.maximums?.[round]);
        const normalized = value.score !== null && maximum > 0 ? (value.score / maximum * 100).toFixed(2) : "—";
        return [`Round ${round}`, value.score ?? "—", value.time ?? "—", normalized, value.available ? "Complete" : "Missing"];
      }),
      styles: { fontSize: 7 }, headStyles: { fillColor: [49, 86, 211] }, theme: "grid", margin: { left: 14, right: 14 }
    });
    if (doc.lastAutoTable.finalY > 180 && team !== teams[teams.length - 1]) doc.addPage();
  }

  doc.addPage();
  addHeader("Summary");
  const participation = [1, 2, 3, 4].map((round) => teams.filter((team) => team.roundValues[`round${round}`].available).length);
  const highest = finalized.length ? Math.max(...finalized.map((team) => team.overallScore)) : null;
  doc.autoTable({
    startY: 25,
    head: [["Metric", "Value"]],
    body: [
      ["Participating teams", teams.length], ["Finalized teams", finalized.length], ["Provisional teams", provisional.length],
      ["Incomplete records", teams.filter((team) => team.completedRounds < 4).length], ["Highest overall score", highest === null ? "—" : score(highest)],
      ["Round 1 participation", participation[0]], ["Round 2 participation", participation[1]], ["Round 3 participation", participation[2]], ["Round 4 participation", participation[3]]
    ],
    styles: { fontSize: 9 }, headStyles: { fillColor: [49, 86, 211] }, theme: "grid"
  });
  addFooter();
  doc.save(`${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "results"}-report.pdf`);
}
