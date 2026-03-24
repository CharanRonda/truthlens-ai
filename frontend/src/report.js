import { jsPDF } from "jspdf";

function colorFromScore(score) {
  if (score >= 80) {
    return [34, 200, 122];
  }
  if (score >= 55) {
    return [245, 166, 35];
  }
  return [240, 79, 79];
}

function signalRgb(value) {
  return colorFromScore(value);
}

function rgbToCss(rgb, alpha = 1) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function sectionHeader(doc, title, y) {
  doc.setFillColor(240, 240, 248);
  doc.rect(14, y - 4, 182, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(50, 50, 60);
  doc.text(title, 14, y);
  return y + 8;
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

function environmentSafetyScore(environment) {
  let safety = 100;
  safety -= Math.max(0, environment.persons_detected - 1) * 35;
  safety -= environment.phone_detected ? 25 : 0;
  safety -= Math.min(20, environment.suspicious_objects.length * 10);

  if (environment.risk_label === "Review") {
    safety -= 15;
  }
  if (environment.risk_label === "High Risk") {
    safety -= 35;
  }

  return Math.max(10, Math.min(100, safety));
}

function createIntegrityPieImage(score, verdictLabel) {
  const { canvas, ctx } = createCanvas(720, 340);
  const scoreColor = colorFromScore(score);
  const startAngle = -Math.PI / 2;
  const scoreAngle = (Math.max(0, Math.min(100, score)) / 100) * Math.PI * 2;
  const centerX = 165;
  const centerY = 175;
  const radius = 110;

  ctx.fillStyle = "#111118";
  ctx.font = "700 28px Arial";
  ctx.fillText("Integrity Score", 34, 48);
  ctx.font = "400 16px Arial";
  ctx.fillStyle = "#7a7a8c";
  ctx.fillText("Pie view of the final behavioral integrity result", 34, 76);

  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.arc(centerX, centerY, radius, startAngle + scoreAngle, startAngle + Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = "#e6e8ef";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.arc(centerX, centerY, radius, startAngle, startAngle + scoreAngle);
  ctx.closePath();
  ctx.fillStyle = rgbToCss(scoreColor, 1);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#d6d8df";
  ctx.stroke();

  ctx.fillStyle = "#111118";
  ctx.font = "700 60px Arial";
  ctx.fillText(String(score), 370, 165);
  ctx.font = "700 22px Arial";
  ctx.fillText("/ 100", 370, 198);

  ctx.font = "700 26px Arial";
  ctx.fillStyle = rgbToCss(scoreColor, 1);
  ctx.fillText(verdictLabel, 370, 238);

  ctx.fillStyle = rgbToCss(scoreColor, 1);
  ctx.fillRect(370, 265, 18, 18);
  ctx.fillStyle = "#111118";
  ctx.font = "400 18px Arial";
  ctx.fillText(`Scored portion (${score}%)`, 400, 280);

  ctx.fillStyle = "#e6e8ef";
  ctx.fillRect(370, 294, 18, 18);
  ctx.fillStyle = "#111118";
  ctx.fillText(`Remaining portion (${100 - score}%)`, 400, 309);

  return canvas.toDataURL("image/png");
}

function createHorizontalBarChartImage({ title, subtitle, items }) {
  const { canvas, ctx } = createCanvas(920, 500);
  const left = 220;
  const right = 80;
  const top = 120;
  const chartWidth = canvas.width - left - right;
  const barHeight = 18;
  const rowGap = 62;

  ctx.fillStyle = "#111118";
  ctx.font = "700 30px Arial";
  ctx.fillText(title, 38, 48);
  ctx.font = "400 16px Arial";
  ctx.fillStyle = "#7a7a8c";
  ctx.fillText(subtitle, 38, 78);

  [0, 25, 50, 75, 100].forEach((tick) => {
    const x = left + (chartWidth * tick) / 100;
    ctx.strokeStyle = "#eceef4";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top - 24);
    ctx.lineTo(x, top + rowGap * (items.length - 1) + 26);
    ctx.stroke();

    ctx.fillStyle = "#7a7a8c";
    ctx.font = "400 13px Arial";
    ctx.fillText(String(tick), x - 7, top - 34);
  });

  items.forEach((item, index) => {
    const y = top + index * rowGap;
    const barWidth = (chartWidth * item.value) / 100;
    const color = rgbToCss(signalRgb(item.value), 0.95);

    ctx.fillStyle = "#222430";
    ctx.font = "600 18px Arial";
    ctx.fillText(item.label, 38, y + 5);

    ctx.fillStyle = "#edeff5";
    ctx.fillRect(left, y - 14, chartWidth, barHeight);

    ctx.fillStyle = color;
    ctx.fillRect(left, y - 14, barWidth, barHeight);

    ctx.fillStyle = "#111118";
    ctx.font = "700 18px Arial";
    ctx.fillText(`${item.value}`, left + chartWidth + 20, y + 2);
  });

  return canvas.toDataURL("image/png");
}

function drawPdfHeader(doc, now) {
  doc.setFillColor(10, 10, 15);
  doc.rect(0, 0, 210, 30, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.setTextColor(240, 240, 244);
  doc.text("ThruthLens AI", 14, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(122, 122, 140);
  doc.text("AI Interview Intelligence Report", 14, 23);
  doc.text(now, 196, 23, { align: "right" });
}

export function generateReportPdf(report) {
  const doc = new jsPDF();
  const now = new Date(report.generated_at).toLocaleString();
  const scoreColor = colorFromScore(report.score);
  const pieImage = createIntegrityPieImage(report.score, report.verdict.label);
  const signalChartImage = createHorizontalBarChartImage({
    title: "Signal Breakdown Graph",
    subtitle: "Weighted signals used inside the integrity scoring engine",
    items: [
      { label: "Emotion Stability", value: report.signals.emotionStability },
      { label: "Eye Contact Ratio", value: report.signals.eyeContactRatio },
      { label: "Voice Calmness", value: report.signals.voiceCalmness },
      { label: "Speaking Pace", value: report.signals.speakingPace },
      { label: "Micro-Expression", value: report.signals.microExpression },
    ],
  });
  const modalityChartImage = createHorizontalBarChartImage({
    title: "Modality Comparison Graph",
    subtitle: "High-level comparison across face, voice, behavior, and environment",
    items: [
      { label: "Facial Stability", value: report.facial.stability_score },
      { label: "Voice Calmness", value: report.signals.voiceCalmness },
      { label: "Eye Contact", value: report.behavior.eye_contact },
      { label: "Movement Stability", value: report.behavior.movement_stability },
      { label: "Environment Safety", value: environmentSafetyScore(report.environment) },
    ],
  });

  drawPdfHeader(doc, now);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(50, 50, 60);
  doc.text("Candidate Report", 14, 42);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 100);
  doc.text(`Name: ${report.candidate_name}`, 14, 51);
  doc.text(`Session Duration: ${report.duration_label}`, 14, 57);
  doc.text(`Verdict: ${report.verdict.label}`, 14, 63);
  doc.text(`Generated: ${now}`, 14, 69);

  doc.addImage(pieImage, "PNG", 112, 34, 84, 40);

  let y = 84;
  y = sectionHeader(doc, "Signal Breakdown", y);
  const signalRows = [
    ["Emotion Stability", report.signals.emotionStability, 0.25],
    ["Eye Contact Ratio", report.signals.eyeContactRatio, 0.2],
    ["Voice Calmness", report.signals.voiceCalmness, 0.25],
    ["Speaking Pace", report.signals.speakingPace, 0.15],
    ["Micro-Expression", report.signals.microExpression, 0.15],
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  signalRows.forEach(([label, value, weight]) => {
    const contribution = (value * weight).toFixed(1);
    const rowColor = colorFromScore(value);
    doc.setTextColor(80, 80, 100);
    doc.text(label, 14, y);
    doc.setFillColor(...rowColor);
    doc.rect(92, y - 4, (value / 100) * 78, 5, "F");
    doc.setTextColor(50, 50, 60);
    doc.text(`${value}/100 (${contribution})`, 176, y, { align: "right" });
    y += 8;
  });

  y += 4;
  y = sectionHeader(doc, "AI Layer Summary", y);
  const aiSummary = [
    `Facial: ${report.facial.dominant} dominant, stability ${report.facial.stability_score}/100`,
    `Voice: ${report.voice.stress_level}, pitch variation ${report.voice.pitch_variation}/100, tremor ${report.voice.tremor_index}/100`,
    `Behavior: eye contact ${report.behavior.eye_contact}/100, looking away ${report.behavior.looking_away_events} times`,
    `Environment: ${report.environment.risk_label}, persons ${report.environment.persons_detected}, phone ${report.environment.phone_detected ? "detected" : "not detected"}`,
  ];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 100);
  aiSummary.forEach((line) => {
    doc.text(line, 14, y);
    y += 7;
  });

  y += 4;
  y = sectionHeader(doc, "Behavioral Flags", y);
  if (!report.flags.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 100);
    doc.text("No flags raised during this session.", 14, y);
    y += 8;
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    report.flags.forEach((flag) => {
      const flagColor =
        flag.severity === "high"
          ? [240, 79, 79]
          : flag.severity === "medium"
            ? [245, 166, 35]
            : [34, 200, 122];
      doc.setFillColor(...flagColor);
      doc.circle(17, y - 1.5, 2, "F");
      doc.setTextColor(80, 80, 100);
      doc.text(`${flag.message} [${flag.time}]`, 22, y);
      y += 7;
    });
  }

  y += 5;
  y = sectionHeader(doc, "Recruiter Recommendation", y);
  const recommendationBackground =
    report.score >= 80
      ? [220, 248, 235]
      : report.score >= 55
        ? [253, 244, 220]
        : [254, 235, 235];
  doc.setFillColor(...recommendationBackground);
  doc.rect(14, y, 182, 24, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(50, 50, 60);
  doc.text("Recommendation", 18, y + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 100);
  const recommendationText = doc.splitTextToSize(report.verdict.message, 168);
  doc.text(recommendationText, 18, y + 15);

  doc.addPage();
  drawPdfHeader(doc, now);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(50, 50, 60);
  doc.text("Analytic Graphs", 14, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 100);
  doc.text("Visual summaries for the final report outputs", 14, 49);

  doc.addImage(signalChartImage, "PNG", 14, 56, 182, 92);
  doc.addImage(modalityChartImage, "PNG", 14, 160, 182, 92);

  doc.setFontSize(8);
  doc.setTextColor(150, 150, 170);
  doc.text(
    "Generated by ThruthLens AI · React + FastAPI Interview Intelligence Demo",
    105,
    285,
    { align: "center" },
  );

  doc.save(`ThruthLens_AI_Report_${report.candidate_name.replace(/\s+/g, "_")}.pdf`);
}
