function roundKey(round) {
  return `round${round}`;
}

export const DEFAULT_CONFIG = {
  method: "normalized",
  maximums: { 1: "", 2: "", 3: "", 4: "" },
  weights: { 1: 1, 2: 1, 3: 1, 4: 1 },
  timeMode: "none",
  timeTieBreaker: "none",
  confirmed: false
};

function isValidRecord(record) {
  return Boolean(record?.teamId && record.teamName && !record.rowIssues?.length);
}

export function integrateRounds(roundResults) {
  const teams = new Map();
  const conflicts = [];
  const duplicates = [];
  for (let round = 1; round <= 4; round += 1) {
    const result = roundResults.get(round);
    if (!result) continue;
    const roundSeen = new Map();
    for (const record of result.records) {
      if (!record.teamId) continue;
      if (roundSeen.has(record.teamId)) {
        duplicates.push({ round, teamId: record.teamId, rows: [roundSeen.get(record.teamId), record.sourceRow] });
      } else roundSeen.set(record.teamId, record.sourceRow);
      if (!teams.has(record.teamId)) {
        teams.set(record.teamId, { teamId: record.teamId, teamName: record.teamName, names: new Set(record.teamName ? [record.teamName] : []), rounds: {} });
      }
      const team = teams.get(record.teamId);
      if (record.teamName) team.names.add(record.teamName);
      if (team.names.size > 1) conflicts.push({ teamId: record.teamId, names: [...team.names] });
      if (!team.rounds[roundKey(round)]) team.rounds[roundKey(round)] = [];
      team.rounds[roundKey(round)].push(record);
    }
  }
  return [...teams.values()].map((team) => ({
    ...team,
    teamName: [...team.names][0] || "",
    nameConflict: team.names.size > 1,
    duplicateRounds: Object.entries(team.rounds).filter(([, records]) => records.length > 1).map(([key]) => Number(key.replace("round", "")))
  })).sort((a, b) => a.teamId.localeCompare(b.teamId));
}

function numericMaximum(config, round) {
  const value = Number(config.maximums?.[round]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function numericWeight(config, round) {
  const value = Number(config.weights?.[round]);
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

function usableRoundRecord(team, round) {
  const records = team.rounds[roundKey(round)] || [];
  return records.length === 1 && isValidRecord(records[0]) ? records[0] : null;
}

export function calculateTeam(team, config = DEFAULT_CONFIG) {
  const roundValues = {};
  const scoreValues = [];
  const timeValues = [];
  const issues = [];
  for (let round = 1; round <= 4; round += 1) {
    const key = roundKey(round);
    const record = usableRoundRecord(team, round);
    roundValues[key] = record ? { score: record.score, time: record.time, sourceRow: record.sourceRow, available: true } : { score: null, time: null, available: false };
    if (team.duplicateRounds.includes(round)) issues.push(`Duplicate records in Round ${round}.`);
    if (record?.score !== null && record?.score !== undefined) {
      const maximum = numericMaximum(config, round);
      if (maximum !== null && record.score > maximum) issues.push(`Round ${round} score exceeds maximum ${maximum}.`);
      scoreValues.push({ round, value: record.score });
    }
    if (record?.time !== null && record?.time !== undefined) timeValues.push({ round, value: record.time });
  }
  if (team.nameConflict) issues.push(`Conflicting Team Names: ${[...team.names].join(", ")}.`);
  const completedRounds = Object.values(roundValues).filter((value) => value.available).length;
  const missingRounds = Object.entries(roundValues).filter(([, value]) => !value.available).map(([key]) => Number(key.replace("round", "")));
  let overallScore = null;
  let resultKind = "score";
  if (config.method === "time" && timeValues.length) {
    overallScore = timeValues.reduce((sum, item) => sum + item.value, 0) / timeValues.length;
    resultKind = "time";
  }
  if (scoreValues.length) {
    if (config.method === "average") overallScore = scoreValues.reduce((sum, item) => sum + item.value, 0) / scoreValues.length;
    if (config.method === "sum") overallScore = scoreValues.reduce((sum, item) => sum + item.value, 0);
    if (config.method === "weighted") overallScore = scoreValues.reduce((sum, item) => sum + item.value * numericWeight(config, item.round), 0);
    if (config.method === "normalized") {
      const normalized = scoreValues.map((item) => {
        const maximum = numericMaximum(config, item.round);
        return maximum === null ? null : item.value / maximum * 100;
      });
      overallScore = normalized.every((value) => value !== null) ? normalized.reduce((sum, value) => sum + value, 0) / normalized.length : null;
      if (overallScore === null) issues.push("Normalized score requires a maximum for every scored round.");
    }
  }
  const finalized = completedRounds === 4 && issues.length === 0 && overallScore !== null && config.confirmed;
  return { ...team, roundValues, scoreValues, timeValues, completedRounds, missingRounds, overallScore, resultKind, issues, eligible: finalized, status: finalized ? "Finalized" : "Provisional" };
}

function tieTime(a, b, config) {
  if (config.timeTieBreaker === "none") return 0;
  const aTimes = a.timeValues.map((item) => item.value);
  const bTimes = b.timeValues.map((item) => item.value);
  if (!aTimes.length || !bTimes.length) return 0;
  const aValue = aTimes.reduce((sum, value) => sum + value, 0) / aTimes.length;
  const bValue = bTimes.reduce((sum, value) => sum + value, 0) / bTimes.length;
  return config.timeTieBreaker === "lower" ? aValue - bValue : bValue - aValue;
}

function tieMetric(team, config) {
  if (config.timeTieBreaker === "none" || !team.timeValues.length) return 0;
  const average = team.timeValues.reduce((sum, item) => sum + item.value, 0) / team.timeValues.length;
  return config.timeTieBreaker === "lower" ? average : -average;
}

export function buildLeaderboard(roundResults, config = DEFAULT_CONFIG) {
  const calculated = integrateRounds(roundResults).map((team) => calculateTeam(team, config));
  const ranked = calculated.filter((team) => team.eligible).sort((a, b) => {
    const scoreDifference = a.resultKind === "time" && config.timeMode === "lower" ? a.overallScore - b.overallScore : b.overallScore - a.overallScore;
    return scoreDifference || tieTime(a, b, config) || a.teamId.localeCompare(b.teamId);
  });
  const rankById = new Map();
  let previousScore = null;
  let previousTime = null;
  let rank = 0;
  ranked.forEach((team, index) => {
    const time = tieMetric(team, config);
    if (team.overallScore !== previousScore || time !== previousTime) rank = index + 1;
    rankById.set(team.teamId, rank);
    previousScore = team.overallScore;
    previousTime = time;
  });
  return calculated.map((team) => ({ ...team, rank: rankById.get(team.teamId) || null })).sort((a, b) => {
    if (a.rank === null) return 1;
    if (b.rank === null) return -1;
    return a.rank - b.rank || a.teamId.localeCompare(b.teamId);
  });
}
