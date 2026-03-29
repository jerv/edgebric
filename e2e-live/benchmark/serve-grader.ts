#!/usr/bin/env tsx
/**
 * Grading UI Server
 *
 * Serves a web-based grading interface for benchmark results.
 * Reads latest.json, serves the grader HTML, accepts grade submissions.
 *
 * Usage:
 *   pnpm exec tsx e2e-live/benchmark/serve-grader.ts
 *   open http://localhost:3099
 */

import http from "http";
import fs from "fs";
import path from "path";

const PORT = 3099;
const RESULTS_DIR = path.join(__dirname, "results");
const GRADES_PATH = path.join(RESULTS_DIR, "grades.json");

function getLatestResults() {
  const latestPath = path.join(RESULTS_DIR, "latest.json");
  if (!fs.existsSync(latestPath)) return null;
  return JSON.parse(fs.readFileSync(latestPath, "utf-8"));
}

function getGrades(): Record<string, Record<string, { score: number; notes: string }>> {
  if (!fs.existsSync(GRADES_PATH)) return {};
  return JSON.parse(fs.readFileSync(GRADES_PATH, "utf-8"));
}

function saveGrades(grades: Record<string, Record<string, { score: number; notes: string }>>) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(GRADES_PATH, JSON.stringify(grades, null, 2));
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Edgebric Model Benchmark Grader</title>
<style>
  :root { --bg: #0f1117; --card: #1a1d27; --border: #2a2d3a; --text: #e4e4e7; --muted: #71717a; --accent: #3b82f6; --green: #22c55e; --red: #ef4444; --yellow: #eab308; --orange: #f97316; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
  .container { max-width: 1400px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  .subtitle { color: var(--muted); margin-bottom: 24px; }

  /* Tabs */
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 24px; overflow-x: auto; }
  .tab { padding: 10px 20px; cursor: pointer; border: none; background: none; color: var(--muted); font-size: 14px; border-bottom: 2px solid transparent; white-space: nowrap; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab .badge { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 10px; font-size: 11px; background: var(--border); }

  /* Summary cards */
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .summary-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .summary-card .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .summary-card .value { font-size: 28px; font-weight: 700; }
  .summary-card .sub { font-size: 12px; color: var(--muted); margin-top: 4px; }

  /* Comparison table */
  .comparison-table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
  .comparison-table th, .comparison-table td { padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--border); font-size: 14px; }
  .comparison-table th { color: var(--muted); font-weight: 500; font-size: 12px; text-transform: uppercase; }
  .comparison-table tr:hover td { background: rgba(59, 130, 246, 0.05); }
  .score-bar { display: inline-block; height: 8px; border-radius: 4px; min-width: 4px; }

  /* Question cards */
  .question-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
  .question-header { padding: 16px 20px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
  .question-header:hover { background: rgba(255,255,255,0.02); }
  .question-id { font-size: 12px; color: var(--muted); font-family: monospace; }
  .question-text { font-weight: 500; margin: 4px 0; }
  .question-meta { display: flex; gap: 12px; align-items: center; }
  .badge-cat { font-size: 11px; padding: 2px 10px; border-radius: 10px; border: 1px solid var(--border); }
  .badge-auto { font-size: 11px; padding: 2px 10px; border-radius: 10px; font-weight: 600; }
  .badge-auto.pass { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge-auto.fail { background: rgba(239,68,68,0.15); color: var(--red); }
  .badge-auto.manual { background: rgba(234,179,8,0.15); color: var(--yellow); }

  .question-body { display: none; padding: 0 20px 20px; border-top: 1px solid var(--border); }
  .question-body.open { display: block; }

  .ground-truth { background: rgba(34,197,94,0.08); border-left: 3px solid var(--green); padding: 12px 16px; border-radius: 0 6px 6px 0; margin-bottom: 12px; }
  .ground-truth .label { font-size: 11px; color: var(--green); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .rubric { background: rgba(59,130,246,0.08); border-left: 3px solid var(--accent); padding: 12px 16px; border-radius: 0 6px 6px 0; margin-bottom: 16px; }
  .rubric .label { font-size: 11px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }

  .model-answers { display: grid; gap: 12px; }
  .model-answer { border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .model-answer .model-name { font-weight: 600; font-size: 14px; margin-bottom: 4px; display: flex; justify-content: space-between; }
  .model-answer .latency { font-size: 12px; color: var(--muted); }
  .model-answer .answer-text { font-size: 14px; margin: 8px 0; padding: 12px; background: var(--bg); border-radius: 6px; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto; }
  .model-answer .citations { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
  .model-answer .keywords { font-size: 12px; margin-bottom: 12px; }
  .kw-found { color: var(--green); }
  .kw-missing { color: var(--red); }

  .grade-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .grade-btn { width: 36px; height: 36px; border-radius: 50%; border: 2px solid var(--border); background: none; color: var(--text); cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.15s; }
  .grade-btn:hover { border-color: var(--accent); }
  .grade-btn.selected { border-color: var(--accent); background: var(--accent); color: white; }
  .grade-btn.s1 { border-color: var(--red); } .grade-btn.s1.selected { background: var(--red); }
  .grade-btn.s2 { border-color: var(--orange); } .grade-btn.s2.selected { background: var(--orange); }
  .grade-btn.s3 { border-color: var(--yellow); } .grade-btn.s3.selected { background: var(--yellow); }
  .grade-btn.s4 { border-color: var(--green); } .grade-btn.s4.selected { background: var(--green); }
  .grade-btn.s5 { border-color: var(--green); } .grade-btn.s5.selected { background: var(--green); }
  .grade-label { font-size: 11px; color: var(--muted); min-width: 80px; }
  .grade-notes { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; color: var(--text); font-size: 13px; }

  /* Progress bar */
  .progress { margin-bottom: 24px; }
  .progress-bar { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--accent); transition: width 0.3s; }
  .progress-text { font-size: 12px; color: var(--muted); margin-top: 4px; }

  .save-btn { position: fixed; bottom: 24px; right: 24px; padding: 12px 24px; background: var(--accent); color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(59,130,246,0.3); z-index: 100; }
  .save-btn:hover { background: #2563eb; }
  .save-btn.saved { background: var(--green); }

  .score-legend { display: flex; gap: 16px; margin-bottom: 16px; font-size: 12px; color: var(--muted); }
  .score-legend span { display: flex; align-items: center; gap: 4px; }
</style>
</head>
<body>
<div class="container" id="app">
  <h1>Edgebric Model Benchmark</h1>
  <p class="subtitle">Grade model answers side-by-side. Click a question to expand, then score 1-5.</p>
  <div id="content">Loading results...</div>
</div>

<button class="save-btn" id="saveBtn" onclick="saveGrades()">Save Grades</button>

<script>
let data = null;
let grades = {};

const SCORE_LABELS = { 1: 'Wrong', 2: 'Poor', 3: 'Okay', 4: 'Good', 5: 'Excellent' };
const CAT_LABELS = { accuracy: 'Factual Accuracy', hallucination: 'Hallucination Detection', privacy: 'Privacy', cross_doc: 'Cross-Document', multi_turn: 'Multi-Turn', instruction: 'Instruction Following' };

async function init() {
  const [resultsRes, gradesRes] = await Promise.all([
    fetch('/api/results'),
    fetch('/api/grades'),
  ]);
  data = await resultsRes.json();
  grades = await gradesRes.json();
  if (!data || !data.models || data.models.length === 0) {
    document.getElementById('content').innerHTML = '<p>No benchmark results found. Run the benchmark first:</p><pre>pnpm exec tsx e2e-live/benchmark/run.ts</pre>';
    return;
  }
  render();
}

function render() {
  const models = data.models;
  const questions = models[0].results;
  const categories = [...new Set(questions.map(q => q.category))];

  let html = '';

  // Summary cards
  html += '<div class="summary-grid">';
  for (const m of models) {
    const graded = Object.keys(grades[m.model] || {}).length;
    const avgScore = getAvgScore(m.model);
    html += '<div class="summary-card">';
    html += '<div class="label">' + m.model + '</div>';
    html += '<div class="value">' + (avgScore > 0 ? avgScore.toFixed(1) : '--') + '<span style="font-size:14px;color:var(--muted)"> /5</span></div>';
    html += '<div class="sub">' + graded + '/' + m.totalQuestions + ' graded | ' + (m.avgLatencyMs/1000).toFixed(1) + 's avg</div>';
    html += '</div>';
  }
  html += '</div>';

  // Comparison table
  html += '<table class="comparison-table"><thead><tr><th>Metric</th>';
  for (const m of models) html += '<th>' + m.model + '</th>';
  html += '</tr></thead><tbody>';

  html += '<tr><td>Auto-pass (keywords)</td>';
  for (const m of models) html += '<td>' + m.autoPassCount + '/' + m.totalQuestions + '</td>';
  html += '</tr>';

  html += '<tr><td>Auto-fail</td>';
  for (const m of models) html += '<td style="color:' + (m.autoFailCount > 0 ? 'var(--red)' : 'var(--green)') + '">' + m.autoFailCount + '/' + m.totalQuestions + '</td>';
  html += '</tr>';

  html += '<tr><td>Avg Latency</td>';
  const latencies = models.map(m => m.avgLatencyMs);
  const minLat = Math.min(...latencies);
  for (const m of models) {
    const isFastest = m.avgLatencyMs === minLat;
    html += '<td style="' + (isFastest ? 'color:var(--green);font-weight:600' : '') + '">' + (m.avgLatencyMs/1000).toFixed(1) + 's</td>';
  }
  html += '</tr>';

  html += '<tr><td>Your Avg Score</td>';
  for (const m of models) {
    const avg = getAvgScore(m.model);
    html += '<td style="font-weight:600">' + (avg > 0 ? avg.toFixed(2) : '--') + '</td>';
  }
  html += '</tr>';

  html += '</tbody></table>';

  // Progress
  const totalToGrade = models.length * questions.length;
  let totalGraded = 0;
  for (const m of models) totalGraded += Object.keys(grades[m.model] || {}).length;
  html += '<div class="progress">';
  html += '<div class="progress-bar"><div class="progress-fill" style="width:' + (totalGraded/totalToGrade*100) + '%"></div></div>';
  html += '<div class="progress-text">' + totalGraded + ' / ' + totalToGrade + ' answers graded</div>';
  html += '</div>';

  // Score legend
  html += '<div class="score-legend">';
  html += '<strong>Scoring:</strong>';
  for (let i = 1; i <= 5; i++) html += '<span><span class="grade-btn s' + i + '" style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;font-size:11px">' + i + '</span> ' + SCORE_LABELS[i] + '</span>';
  html += '</div>';

  // Questions by category
  for (const cat of categories) {
    const catQuestions = questions.filter(q => q.category === cat);
    html += '<h2 style="margin:24px 0 12px;font-size:18px">' + (CAT_LABELS[cat] || cat) + ' (' + catQuestions.length + ')</h2>';

    for (const q of catQuestions) {
      html += renderQuestion(q, models);
    }
  }

  document.getElementById('content').innerHTML = html;
}

function renderQuestion(q, models) {
  let html = '<div class="question-card" id="card-' + q.questionId + '">';

  // Header
  html += '<div class="question-header" onclick="toggleCard(\\'' + q.questionId + '\\')">';
  html += '<div>';
  html += '<div class="question-id">' + q.questionId + '</div>';
  html += '<div class="question-text">' + escHtml(q.question) + '</div>';
  html += '</div>';
  html += '<div class="question-meta">';
  html += '<span class="badge-cat">' + (CAT_LABELS[q.category] || q.category) + '</span>';

  // Show per-model auto scores
  for (const m of models) {
    const mr = m.results.find(r => r.questionId === q.questionId);
    if (mr) {
      const g = (grades[m.model] || {})[q.questionId];
      if (g) {
        html += '<span class="badge-auto ' + (g.score >= 4 ? 'pass' : g.score <= 2 ? 'fail' : 'manual') + '" title="' + m.model + '">' + m.model.split(':')[0] + ': ' + g.score + '/5</span>';
      } else {
        html += '<span class="badge-auto ' + mr.autoScore + '" title="' + m.model + '">' + m.model.split(':')[0] + ': ' + mr.autoScore + '</span>';
      }
    }
  }
  html += '</div></div>';

  // Body
  html += '<div class="question-body" id="body-' + q.questionId + '">';
  html += '<div class="ground-truth"><div class="label">Ground Truth</div>' + escHtml(q.groundTruth) + '</div>';
  html += '<div class="rubric"><div class="label">Grading Rubric</div>' + escHtml(q.rubric) + '</div>';

  html += '<div class="model-answers">';
  for (const m of models) {
    const mr = m.results.find(r => r.questionId === q.questionId);
    if (!mr) continue;

    const g = (grades[m.model] || {})[q.questionId];

    html += '<div class="model-answer">';
    html += '<div class="model-name"><span>' + m.model + '</span><span class="latency">' + (mr.latencyMs/1000).toFixed(1) + 's</span></div>';
    html += '<div class="answer-text">' + escHtml(mr.answer || '(empty)') + '</div>';

    if (mr.citations && mr.citations.length > 0) {
      html += '<div class="citations">Citations: ' + mr.citations.map(c => c.documentName || 'unknown').join(', ') + '</div>';
    }

    if (mr.strictKeywordsFound.length > 0 || mr.strictKeywordsMissing.length > 0) {
      html += '<div class="keywords">';
      if (mr.strictKeywordsFound.length) html += '<span class="kw-found">Found: ' + mr.strictKeywordsFound.join(', ') + '</span> ';
      if (mr.strictKeywordsMissing.length) html += '<span class="kw-missing">Missing: ' + mr.strictKeywordsMissing.join(', ') + '</span>';
      html += '</div>';
    }

    // Grade buttons
    html += '<div class="grade-row">';
    html += '<span class="grade-label">Score:</span>';
    for (let i = 1; i <= 5; i++) {
      const sel = g && g.score === i ? ' selected' : '';
      html += '<button class="grade-btn s' + i + sel + '" onclick="setGrade(\\'' + m.model + '\\',\\'' + q.questionId + '\\',' + i + ',this)" title="' + SCORE_LABELS[i] + '">' + i + '</button>';
    }
    html += '<input class="grade-notes" placeholder="Notes (optional)" value="' + escAttr(g?.notes || '') + '" onchange="setNotes(\\'' + m.model + '\\',\\'' + q.questionId + '\\',this.value)">';
    html += '</div>';

    html += '</div>';
  }
  html += '</div>';

  html += '</div></div>';
  return html;
}

function toggleCard(id) {
  const body = document.getElementById('body-' + id);
  body.classList.toggle('open');
}

function setGrade(model, qid, score, btn) {
  if (!grades[model]) grades[model] = {};
  grades[model][qid] = { score, notes: grades[model][qid]?.notes || '' };

  // Update UI
  const row = btn.parentElement;
  row.querySelectorAll('.grade-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');

  // Update header badge
  render();
  // Re-open the card
  const body = document.getElementById('body-' + qid);
  if (body) body.classList.add('open');
}

function setNotes(model, qid, notes) {
  if (!grades[model]) grades[model] = {};
  if (!grades[model][qid]) grades[model][qid] = { score: 0, notes: '' };
  grades[model][qid].notes = notes;
}

function getAvgScore(model) {
  const mg = grades[model];
  if (!mg) return 0;
  const scores = Object.values(mg).map(g => g.score).filter(s => s > 0);
  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

async function saveGrades() {
  const btn = document.getElementById('saveBtn');
  btn.textContent = 'Saving...';
  await fetch('/api/grades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(grades),
  });
  btn.textContent = 'Saved!';
  btn.classList.add('saved');
  setTimeout(() => { btn.textContent = 'Save Grades'; btn.classList.remove('saved'); }, 2000);
}

function escHtml(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return (s||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

init();
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
  } else if (req.method === "GET" && req.url === "/api/results") {
    const results = getLatestResults();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(results ?? { models: [] }));
  } else if (req.method === "GET" && req.url === "/api/grades") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getGrades()));
  } else if (req.method === "POST" && req.url === "/api/grades") {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const newGrades = JSON.parse(body);
        saveGrades(newGrades);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400);
        res.end("Invalid JSON");
      }
    });
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Grading UI: http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop.\n");
});
