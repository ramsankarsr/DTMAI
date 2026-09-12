/**
 * PROJECT: Dengue Dynamic Transmission & HEOR Model (Dengue DTM 2025)
 * DESCRIPTION: High-Performance Canvas & SVG Interactive Visualization Engine
 */

export class DengueChartRenderer {
  constructor() {}

  /**
   * Render Multi-Line Time Series Chart (Epidemic curves over 30 years)
   */
  renderTimeSeries(canvasId, seriesList, options = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.parentElement.clientWidth || 800;
    const height = canvas.height = options.height || 320;

    ctx.clearRect(0, 0, width, height);

    const padding = { top: 30, right: 30, bottom: 45, left: 65 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    if (seriesList.length === 0 || !seriesList[0].data || seriesList[0].data.length === 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data available', width / 2, height / 2);
      return;
    }

    const maxLen = Math.max(...seriesList.map(s => s.data.length));
    let maxVal = Math.max(...seriesList.flatMap(s => s.data));
    if (maxVal <= 0) maxVal = 100;
    maxVal *= 1.15; // padding top

    // Background grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    const yTicks = 5;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';

    for (let i = 0; i <= yTicks; i++) {
      const yVal = (maxVal / yTicks) * i;
      const yPos = padding.top + chartH - (i / yTicks) * chartH;
      ctx.beginPath();
      ctx.moveTo(padding.left, yPos);
      ctx.lineTo(padding.left + chartW, yPos);
      ctx.stroke();

      const label = options.formatY ? options.formatY(yVal) : (yVal >= 1e6 ? `${(yVal / 1e6).toFixed(1)}M` : (yVal >= 1e3 ? `${(yVal / 1e3).toFixed(0)}k` : yVal.toFixed(0)));
      ctx.fillText(label, padding.left - 10, yPos + 4);
    }

    // X axis ticks
    ctx.textAlign = 'center';
    const xStep = Math.max(1, Math.floor(maxLen / 6));
    for (let i = 0; i < maxLen; i += xStep) {
      const xPos = padding.left + (i / (maxLen - 1)) * chartW;
      ctx.beginPath();
      ctx.moveTo(xPos, padding.top + chartH);
      ctx.lineTo(xPos, padding.top + chartH + 5);
      ctx.stroke();

      const label = options.labels ? options.labels[i] : `Yr ${i + 1}`;
      ctx.fillText(label, xPos, padding.top + chartH + 20);
    }

    // Draw series
    seriesList.forEach((series) => {
      if (!series.data || series.data.length === 0) return;

      ctx.beginPath();
      ctx.strokeStyle = series.color || '#00e5ff';
      ctx.lineWidth = series.lineWidth || 2.5;

      series.data.forEach((val, i) => {
        const xPos = padding.left + (i / (maxLen - 1)) * chartW;
        const yPos = padding.top + chartH - (val / maxVal) * chartH;
        if (i === 0) ctx.moveTo(xPos, yPos);
        else ctx.lineTo(xPos, yPos);
      });
      ctx.stroke();

      // Area fill if requested
      if (series.fill) {
        ctx.lineTo(padding.left + chartW, padding.top + chartH);
        ctx.lineTo(padding.left, padding.top + chartH);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
        grad.addColorStop(0, series.fillColor || 'rgba(0, 229, 255, 0.25)');
        grad.addColorStop(1, 'rgba(0, 229, 255, 0.0)');
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Draw points
      if (series.showPoints) {
        ctx.fillStyle = series.color;
        series.data.forEach((val, i) => {
          const xPos = padding.left + (i / (maxLen - 1)) * chartW;
          const yPos = padding.top + chartH - (val / maxVal) * chartH;
          ctx.beginPath();
          ctx.arc(xPos, yPos, 3.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    });

    // Legend
    if (options.showLegend !== false) {
      this._renderLegend(ctx, seriesList, padding.left, 15);
    }
  }

  /**
   * Render Stacked or Grouped Bar Chart (Costs, Budget Impact)
   */
  renderBarChart(canvasId, categories, seriesList, options = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.parentElement.clientWidth || 800;
    const height = canvas.height = options.height || 320;

    ctx.clearRect(0, 0, width, height);

    const padding = { top: 30, right: 30, bottom: 45, left: 75 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const numCategories = categories.length;
    const numSeries = seriesList.length;

    let maxVal = 0;
    if (options.stacked) {
      for (let c = 0; c < numCategories; c++) {
        let sum = 0;
        for (let s = 0; s < numSeries; s++) {
          sum += seriesList[s].data[c] || 0;
        }
        if (sum > maxVal) maxVal = sum;
      }
    } else {
      maxVal = Math.max(...seriesList.flatMap(s => s.data));
    }
    if (maxVal <= 0) maxVal = 100;
    maxVal *= 1.15;

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';

    for (let i = 0; i <= 5; i++) {
      const yVal = (maxVal / 5) * i;
      const yPos = padding.top + chartH - (i / 5) * chartH;
      ctx.beginPath();
      ctx.moveTo(padding.left, yPos);
      ctx.lineTo(padding.left + chartW, yPos);
      ctx.stroke();

      const label = options.formatY ? options.formatY(yVal) : `$${(yVal / 1e6).toFixed(1)}M`;
      ctx.fillText(label, padding.left - 10, yPos + 4);
    }

    const groupWidth = chartW / numCategories;
    const barPadding = groupWidth * 0.25;
    const usableWidth = groupWidth - barPadding;

    // Draw bars
    if (options.stacked) {
      for (let c = 0; c < numCategories; c++) {
        const xPos = padding.left + c * groupWidth + barPadding / 2;
        let currY = padding.top + chartH;

        for (let s = 0; s < numSeries; s++) {
          const val = seriesList[s].data[c] || 0;
          const barH = (val / maxVal) * chartH;
          currY -= barH;

          ctx.fillStyle = seriesList[s].color;
          ctx.fillRect(xPos, currY, usableWidth, barH);
        }

        // X Label
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText(categories[c], xPos + usableWidth / 2, padding.top + chartH + 20);
      }
    } else {
      const singleBarW = usableWidth / numSeries;
      for (let c = 0; c < numCategories; c++) {
        const groupX = padding.left + c * groupWidth + barPadding / 2;

        for (let s = 0; s < numSeries; s++) {
          const val = seriesList[s].data[c] || 0;
          const barH = (val / maxVal) * chartH;
          const xPos = groupX + s * singleBarW;
          const yPos = padding.top + chartH - barH;

          ctx.fillStyle = seriesList[s].color;
          ctx.fillRect(xPos, yPos, singleBarW - 2, barH);
        }

        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText(categories[c], groupX + usableWidth / 2, padding.top + chartH + 20);
      }
    }

    if (options.showLegend !== false) {
      this._renderLegend(ctx, seriesList, padding.left, 15);
    }
  }

  /**
   * Render Cost-Effectiveness Plane (Scatter + WTP Frontiers)
   */
  renderCEAPlane(canvasId, comparisonPoints, wtpThreshold = 7000) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.parentElement.clientWidth || 800;
    const height = canvas.height = 360;

    ctx.clearRect(0, 0, width, height);

    const padding = { top: 30, right: 40, bottom: 50, left: 80 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // Origin (0,0) is centered or offset
    const originX = padding.left + chartW * 0.25;
    const originY = padding.top + chartH * 0.55;

    // Axes
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;

    // X axis (DALYs Averted)
    ctx.beginPath();
    ctx.moveTo(padding.left, originY);
    ctx.lineTo(padding.left + chartW, originY);
    ctx.stroke();

    // Y axis (Incremental Cost $)
    ctx.beginPath();
    ctx.moveTo(originX, padding.top);
    ctx.lineTo(originX, padding.top + chartH);
    ctx.stroke();

    // WTP Threshold Frontier Line: Delta Cost = WTP * DALYs Averted
    ctx.beginPath();
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);

    const maxDALY = 250000;
    const maxCost = 300000000; // $300M

    // Line from origin
    const endDALY = maxDALY;
    const endCost = endDALY * wtpThreshold;
    const endX = originX + (endDALY / maxDALY) * (chartW * 0.7);
    const endY = originY - (endCost / maxCost) * (chartH * 0.45);

    ctx.moveTo(originX, originY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Quadrant labels
    ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('DOMINANT (Cost-Saving)', padding.left + chartW - 10, originY + 25);

    ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
    ctx.textAlign = 'left';
    ctx.fillText('DOMINATED', padding.left + 15, padding.top + 25);

    ctx.fillStyle = '#64748b';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Incremental DALYs Averted (Health Gain) \u2192', originX + chartW * 0.35, originY + 35);

    ctx.save();
    ctx.translate(padding.left - 50, originY);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('\u2190 Cost Saving | Incremental Cost ($) \u2192', 0, 0);
    ctx.restore();

    // Plot points
    comparisonPoints.forEach((pt) => {
      const ptX = originX + (pt.dalysAverted / maxDALY) * (chartW * 0.7);
      const ptY = originY - (pt.deltaCost / maxCost) * (chartH * 0.45);

      // Glow circle
      ctx.beginPath();
      ctx.arc(ptX, ptY, 7, 0, Math.PI * 2);
      ctx.fillStyle = pt.color || '#38bdf8';
      ctx.shadowColor = pt.color || '#38bdf8';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Outer ring
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Label
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(pt.label, ptX + 12, ptY + 4);
    });
  }

  _renderLegend(ctx, seriesList, x, y) {
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'left';
    let currentX = x;

    seriesList.forEach((s) => {
      if (!s.label) return;
      ctx.fillStyle = s.color;
      ctx.fillRect(currentX, y - 8, 12, 10);

      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(s.label, currentX + 16, y);
      currentX += ctx.measureText(s.label).width + 30;
    });
  }
}
