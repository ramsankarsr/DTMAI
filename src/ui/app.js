/**
 * PROJECT: Dengue Dynamic Transmission & HEOR Model (Dengue DTM 2025)
 * DESCRIPTION: Main Interactive Application Controller & State Engine
 * REPLICATING: Shen, Kharitonova et al. (PLOS Medicine 2025)
 */

import { DengueSimulationModel, NUM_AGES } from '../engine/dengue_engine.js';
import { VaccineEfficacyManager } from '../engine/markov_booster.js';
import { DiscreteTransitionEngine } from '../engine/discrete_transitions.js';
import { HEOREngine } from '../engine/heor_engine.js';
import { DengueChartRenderer } from './charts.js';
import { SCENARIO_PRESETS } from './scenario_presets.js';
import { BASELINE_HINI_FLAT, BASELINE_VINI, THAILAND_EPI_DATA } from '../data/thailand_model_data.js';

export class DengueApp {
  constructor() {
    this.chartRenderer = new DengueChartRenderer();
    this.discreteEngine = new DiscreteTransitionEngine(THAILAND_EPI_DATA);

    // App state
    this.timeframe = 20; // 20 years default from paper
    this.currentPresetId = 'r11_base';
    this.activeTab = 'dashboard';
    this.isSimulating = false;

    // Simulation cached results
    this.baselineResults = null;
    this.activeScenarioResults = null;
    this.allScenarioResults = new Map(); // presetId -> results

    // Active configuration
    this.config = { ...SCENARIO_PRESETS[1] }; // Default R11 Base
  }

  async init() {
    this._bindEvents();
    this._populatePresetsDropdown();
    this._renderPresetDetails();

    // Initial simulation run: Baseline + Active preset
    await this.runAllScenarios();
    this.updateUI();
  }

  _bindEvents() {
    // Tab switching
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabTarget = e.currentTarget.dataset.tab;
        this.switchTab(tabTarget);
      });
    });

    // Preset selection change
    const presetSelect = document.getElementById('presetSelect');
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        this.selectPreset(e.target.value);
      });
    }

    // Documentation Load Preset buttons
    document.querySelectorAll('.doc-preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const presetId = e.currentTarget.dataset.preset;
        if (presetId) {
          const select = document.getElementById('presetSelect');
          if (select) select.value = presetId;
          this.selectPreset(presetId);
          this.switchTab('dashboard');
        }
      });
    });

    // Run Simulation button
    const runBtn = document.getElementById('runSimBtn');
    if (runBtn) {
      runBtn.addEventListener('click', () => this.runSimulation());
    }

    // Reset Defaults
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.selectPreset('r11_base');
      });
    }

    // Export CSV
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => this.exportResultsToCSV());
    }

    // Export JSON
    const exportJsonBtn = document.getElementById('exportJsonBtn');
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', () => this.exportResultsToJSON());
    }

    // Bind parameter inputs
    this._bindInput('vacEnabled', 'change', (val) => { this.config.vacEnabled = val; });
    this._bindInput('routineAge', 'input', (val) => { this.config.routineAge = parseInt(val); this._updateLabel('routineAgeVal', `${val} years`); });
    this._bindInput('coverage', 'input', (val) => { this.config.coverage = parseFloat(val); this._updateLabel('coverageVal', `${val}%`); });
    this._bindInput('catchUpEnabled', 'change', (val) => { this.config.catchUpEnabled = val; });
    this._bindInput('catchUpMin', 'input', (val) => { this.config.catchUpMin = parseInt(val); this._updateLabel('catchUpMinVal', `${val} yrs`); });
    this._bindInput('catchUpMax', 'input', (val) => { this.config.catchUpMax = parseInt(val); this._updateLabel('catchUpMaxVal', `${val} yrs`); });
    this._bindInput('testBeforeVac', 'change', (val) => { this.config.testBeforeVac = val; });
    
    this._bindInput('vecEnabled', 'change', (val) => { this.config.vecEnabled = val; });
    this._bindInput('vecBitingReduction', 'input', (val) => { this.config.vecBitingReduction = parseFloat(val); this._updateLabel('vecBitingVal', `${val}%`); });
    this._bindInput('vecRatioReduction', 'input', (val) => { this.config.vecRatioReduction = parseFloat(val); this._updateLabel('vecRatioVal', `${val}%`); });
    
    this._bindInput('vaccinePrice', 'input', (val) => { this.config.vaccinePrice = parseFloat(val); this._updateLabel('vaccinePriceVal', `$${val}`); });
    this._bindInput('discountRate', 'input', (val) => { this.config.discountRate = parseFloat(val); this._updateLabel('discountRateVal', `${val}%`); });
    this._bindInput('perspective', 'change', (val) => { this.config.perspective = val; });
    this._bindInput('timeframeSelect', 'change', (val) => { this.timeframe = parseInt(val); });
  }

  _bindInput(id, eventType, callback) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(eventType, (e) => {
      const val = el.type === 'checkbox' ? el.checked : el.value;
      callback(val);
    });
  }

  _updateLabel(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  _populatePresetsDropdown() {
    const select = document.getElementById('presetSelect');
    if (!select) return;
    select.innerHTML = '';
    SCENARIO_PRESETS.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === this.currentPresetId) opt.selected = true;
      select.appendChild(opt);
    });
  }

  _renderPresetDetails() {
    const p = SCENARIO_PRESETS.find(x => x.id === this.currentPresetId);
    if (!p) return;
    const descEl = document.getElementById('presetDescription');
    if (descEl) descEl.textContent = p.description;

    // Update controls
    this._setVal('vacEnabled', p.vacEnabled);
    this._setVal('routineAge', p.routineAge);
    this._updateLabel('routineAgeVal', `${p.routineAge} years`);
    this._setVal('coverage', p.coverage);
    this._updateLabel('coverageVal', `${p.coverage}%`);
    this._setVal('catchUpEnabled', p.catchUpEnabled);
    this._setVal('catchUpMin', p.catchUpMin);
    this._updateLabel('catchUpMinVal', `${p.catchUpMin} yrs`);
    this._setVal('catchUpMax', p.catchUpMax);
    this._updateLabel('catchUpMaxVal', `${p.catchUpMax} yrs`);
    this._setVal('testBeforeVac', p.testBeforeVac);

    this._setVal('vecEnabled', p.vecEnabled);
    this._setVal('vecBitingReduction', p.vecBitingReduction || 0);
    this._updateLabel('vecBitingVal', `${p.vecBitingReduction || 0}%`);
    this._setVal('vecRatioReduction', p.vecRatioReduction || 0);
    this._updateLabel('vecRatioVal', `${p.vecRatioReduction || 0}%`);

    this._setVal('vaccinePrice', p.vaccinePrice || 30);
    this._updateLabel('vaccinePriceVal', `$${p.vaccinePrice || 30}`);
    this._setVal('discountRate', p.discountRate || 3);
    this._updateLabel('discountRateVal', `${p.discountRate || 3}%`);
    this._setVal('perspective', p.perspective || 'societal');
  }

  _setVal(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = Boolean(val);
    else el.value = val;
  }

  selectPreset(presetId) {
    this.currentPresetId = presetId;
    const p = SCENARIO_PRESETS.find(x => x.id === presetId);
    if (p) {
      this.config = { ...p };
      this._renderPresetDetails();
      this.runSimulation();
    }
  }

  switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(p => {
      p.classList.toggle('active', p.id === `${tabId}Tab`);
    });

    // Re-render current tab charts
    this.renderCurrentTabCharts();
  }

  /**
   * Run dynamic simulation for a specific configuration
   */
  async simulateScenario(cfg) {
    const vacEffManager = new VaccineEfficacyManager({ timeframe: this.timeframe });
    const model = new DengueSimulationModel({
      timeframe: this.timeframe,
      vacSwitch: cfg.vacEnabled,
      vecSwitch: cfg.vecEnabled,
      vecBChange: cfg.vecEnabled ? 1.0 - (cfg.vecBitingReduction / 100.0) : 1.0,
      vecRatioVHChange: cfg.vecEnabled ? 1.0 - (cfg.vecRatioReduction / 100.0) : 1.0
    });

    // Initial state vector
    let currentH = new Float64Array(BASELINE_HINI_FLAT);
    if (cfg.vacEnabled) {
      // Allocate 3 vac levels
      const expandedH = new Float64Array(BASELINE_HINI_FLAT.length * 3);
      expandedH.set(BASELINE_HINI_FLAT, 0);
      currentH = expandedH;
    }

    let currentV = new Float64Array(BASELINE_VINI);
    const annualIncidences = [];
    const annualVaccinated = [];
    const annualScreened = [];

    const vacConfig = {
      enabled: cfg.vacEnabled,
      routineAge: cfg.routineAge,
      coverage: cfg.coverage,
      catchUpEnabled: cfg.catchUpEnabled,
      catchUpMin: cfg.catchUpMin,
      catchUpMax: cfg.catchUpMax,
      catchUpYears: 1,
      testBeforeVac: cfg.testBeforeVac,
      testSensitivity: cfg.testSensitivity || 95,
      testSpecificity: cfg.testSpecificity || 90
    };

    // Year-by-year simulation loop
    for (let yr = 0; yr < this.timeframe; yr++) {
      // 1. Ageing & annual vaccination pulse on Dec 31
      const vacLevels = cfg.vacEnabled ? 3 : 1;
      currentH = this.discreteEngine.applyAgeing(currentH, vacLevels);

      if (cfg.vacEnabled) {
        const pulseRes = this.discreteEngine.applyVaccination(currentH, vacConfig, yr + 1, vacEffManager);
        currentH = pulseRes.nextH;
        annualVaccinated.push(pulseRes.newVaccinatedCount);
        annualScreened.push(pulseRes.newScreenedCount);
      } else {
        annualVaccinated.push(0);
        annualScreened.push(0);
      }

      // 2. Continuous ODE transmission
      const simRes = model.simulateYear(yr, currentH, currentV, vacEffManager);
      currentH = simRes.nextHostState;
      currentV = simRes.nextVectorState;
      annualIncidences.push(simRes.annualIncidence);

      vacEffManager.incrementYear();
    }

    // 3. Health Economic Evaluation
    const heor = new HEOREngine({
      perspective: cfg.perspective || 'societal',
      discountRate: cfg.discountRate || 3.0,
      vaccinePricePerDose: cfg.vaccinePrice || 30.0,
      annualVectorControlCost: cfg.vecEnabled ? (cfg.annualVecCost || 15000000) : 0
    });

    const ecoRes = heor.evaluateSimulation(annualIncidences, annualVaccinated, annualScreened, this.timeframe);

    return {
      config: cfg,
      annualIncidences,
      annualVaccinated,
      annualScreened,
      economicResults: ecoRes
    };
  }

  async runSimulation() {
    this._setLoading(true);
    try {
      // Always ensure baseline is simulated
      if (!this.baselineResults) {
        this.baselineResults = await this.simulateScenario(SCENARIO_PRESETS[0]); // baseline
        this.allScenarioResults.set('baseline', this.baselineResults);
      }

      // Simulate active configuration
      const activeRes = await this.simulateScenario(this.config);
      this.activeScenarioResults = activeRes;
      this.allScenarioResults.set(this.currentPresetId, activeRes);

      this.updateUI();
    } catch (e) {
      console.error('Simulation error:', e);
      alert('Error running simulation: ' + e.message);
    } finally {
      this._setLoading(false);
    }
  }

  async runAllScenarios() {
    this._setLoading(true);
    try {
      this.baselineResults = await this.simulateScenario(SCENARIO_PRESETS[0]);
      this.allScenarioResults.set('baseline', this.baselineResults);

      for (let p of SCENARIO_PRESETS) {
        if (p.id === 'baseline') continue;
        const res = await this.simulateScenario(p);
        this.allScenarioResults.set(p.id, res);
      }

      this.activeScenarioResults = this.allScenarioResults.get(this.currentPresetId) || this.allScenarioResults.get('r11_base');
    } finally {
      this._setLoading(false);
    }
  }

  _setLoading(isLoading) {
    this.isSimulating = isLoading;
    const btn = document.getElementById('runSimBtn');
    if (btn) {
      btn.disabled = isLoading;
      btn.textContent = isLoading ? 'Simulating 4-Serotypes...' : 'Run Simulation';
    }
    const indicator = document.getElementById('statusIndicator');
    if (indicator) {
      indicator.className = isLoading ? 'status-indicator running' : 'status-indicator ready';
      indicator.textContent = isLoading ? 'Simulating...' : 'Ready / Simulated';
    }
  }

  updateUI() {
    if (!this.baselineResults || !this.activeScenarioResults) return;

    const heor = new HEOREngine({
      perspective: this.config.perspective || 'societal',
      discountRate: this.config.discountRate || 3.0,
      vaccinePricePerDose: this.config.vaccinePrice || 30.0
    });

    const comparative = heor.computeComparativeHEOR(this.baselineResults.economicResults, this.activeScenarioResults.economicResults);

    // Update KPI Metric Cards
    this._updateText('kpiInfectionsAverted', `${(comparative.casesAverted / 1e6).toFixed(2)}M`);
    this._updateText('kpiInfectionsAvertedPct', `-${comparative.pctCasesAverted.toFixed(1)}% vs Baseline`);

    this._updateText('kpiHospAverted', `${(comparative.hospAverted / 1e3).toFixed(1)}k`);
    this._updateText('kpiHospAvertedPct', `-${comparative.pctHospAverted.toFixed(1)}% Hospitalizations`);

    this._updateText('kpiDalysAverted', `${(comparative.dalysAverted / 1e3).toFixed(1)}k`);
    this._updateText('kpiQalysGained', `+${(comparative.qalysGained / 1e3).toFixed(1)}k QALYs`);

    const netSavings = -comparative.deltaCost;
    this._updateText('kpiNetCost', `${netSavings >= 0 ? '+' : '-'}$${Math.abs(netSavings / 1e6).toFixed(1)}M`);
    this._updateText('kpiNetCostLabel', netSavings >= 0 ? 'Net Cost Savings (Discounted)' : 'Net Budget Investment (Discounted)');

    const icerText = comparative.deltaCost < 0 ? 'DOMINANT (Cost-Saving)' : `$${comparative.icerPerDALY.toFixed(0)} / DALY`;
    this._updateText('kpiICER', icerText);

    // Update Status Banner
    const banner = document.getElementById('ceaBanner');
    if (banner) {
      banner.className = `cea-banner ${comparative.classification.includes('Dominant') ? 'dominant' : 'cost-effective'}`;
      banner.innerHTML = `
        <div class="banner-badge">${comparative.classification}</div>
        <div class="banner-text">
          Under Thailand's Willingness-to-Pay threshold of <strong>$7,000 / DALY</strong> (1&times; GDP per capita), this strategy achieves 
          <strong>${(comparative.dalysAverted / 1e3).toFixed(1)}k DALYs averted</strong> with 
          ${comparative.deltaCost < 0 ? `<strong>$${Math.abs(comparative.deltaCost / 1e6).toFixed(1)}M in net healthcare savings</strong>.` : `an ICER of <strong>$${comparative.icerPerDALY.toFixed(0)} / DALY</strong>.`}
        </div>
      `;
    }

    // Render active tab charts
    this.renderCurrentTabCharts();
    this.renderComparisonTable();
  }

  _updateText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  renderCurrentTabCharts() {
    if (!this.baselineResults || !this.activeScenarioResults) return;

    const baseEpi = this.baselineResults.annualIncidences;
    const actEpi = this.activeScenarioResults.annualIncidences;
    const actEco = this.activeScenarioResults.economicResults;
    const baseEco = this.baselineResults.economicResults;

    const years = Array.from({ length: this.timeframe }, (_, i) => `Yr ${i + 1}`);

    // Tab 1: Dashboard Chart (Symptomatic Cases Comparison)
    if (this.activeTab === 'dashboard') {
      this.chartRenderer.renderTimeSeries('dashboardEpidemicChart', [
        {
          label: 'Baseline (No Intervention)',
          data: baseEpi.map(x => x.totalSymptomatic),
          color: '#ef4444',
          lineWidth: 2.5
        },
        {
          label: this.config.name || 'Selected Strategy',
          data: actEpi.map(x => x.totalSymptomatic),
          color: '#10b981',
          lineWidth: 3,
          fill: true,
          fillColor: 'rgba(16, 185, 129, 0.15)'
        }
      ], {
        labels: years,
        formatY: val => (val / 1e3).toFixed(0) + 'k cases'
      });

      this.chartRenderer.renderBarChart('dashboardCostBarChart', 
        ['Yr 1', 'Yr 5', 'Yr 10', 'Yr 15', 'Yr 20'],
        [
          { label: 'Baseline Cost', color: '#ef4444', data: [0, 4, 9, 14, 19].map(i => baseEco.annualOutcomes[i]?.costs.totalCost || 0) },
          { label: 'Strategy Cost', color: '#38bdf8', data: [0, 4, 9, 14, 19].map(i => actEco.annualOutcomes[i]?.costs.totalCost || 0) }
        ],
        { formatY: val => `$${(val / 1e6).toFixed(1)}M` }
      );
    }

    // Tab 2: Epidemiology Tab (4 Serotypes Trajectory + Age Profile)
    if (this.activeTab === 'epidemiology') {
      this.chartRenderer.renderTimeSeries('epiSerotypeChart', [
        { label: 'DENV-1', data: actEpi.map(x => x.bySerotype[0]), color: '#38bdf8' },
        { label: 'DENV-2', data: actEpi.map(x => x.bySerotype[1]), color: '#f59e0b' },
        { label: 'DENV-3', data: actEpi.map(x => x.bySerotype[2]), color: '#ec4899' },
        { label: 'DENV-4', data: actEpi.map(x => x.bySerotype[3]), color: '#8b5cf6' }
      ], { labels: years });

      // Hospitalization by Age Cohort (Year 10 snapshot)
      const yr10Epi = actEpi[Math.min(actEpi.length - 1, 9)];
      const ageLabels = Array.from({ length: 21 }, (_, i) => `${i * 5}y`);
      const ageGroupData = [];
      for (let g = 0; g < 20; g++) {
        let sum = 0;
        for (let a = g * 5; a < (g + 1) * 5; a++) {
          sum += yr10Epi.byAgeAndSeverity[a][2] + yr10Epi.byAgeAndSeverity[a][4];
        }
        ageGroupData.push(sum);
      }
      ageGroupData.push(yr10Epi.byAgeAndSeverity[100][2] + yr10Epi.byAgeAndSeverity[100][4]);

      this.chartRenderer.renderBarChart('epiAgeHospChart', ageLabels, [
        { label: 'Annual Hospitalizations by Age (Year 10)', color: '#00e5ff', data: ageGroupData }
      ], { formatY: val => val.toFixed(0) });
    }

    // Tab 3: Health Economics Tab (Cost Breakdown & CEA Plane)
    if (this.activeTab === 'economics') {
      const lastYrEco = actEco.annualOutcomes[Math.min(actEco.annualOutcomes.length - 1, 9)];
      const costCategories = ['Direct Medical', 'Direct Non-Med', 'Lost Wages', 'School Days', 'Vaccine & Admin'];
      
      this.chartRenderer.renderBarChart('ecoCostBreakdownChart', costCategories, [
        {
          label: 'Annual Costs (Year 10)',
          color: '#38bdf8',
          data: [
            lastYrEco.costs.directMedical,
            lastYrEco.costs.directNonMedical,
            lastYrEco.costs.indirectProductivity,
            lastYrEco.costs.schoolAbsenteeism,
            lastYrEco.costs.vaccineAcquisition + lastYrEco.costs.vaccineAdmin
          ]
        }
      ], { formatY: val => `$${(val / 1e6).toFixed(2)}M` });

      // Cost-Effectiveness Plane
      const comparisonPts = [];
      const heor = new HEOREngine();
      const colors = ['#38bdf8', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];
      let cIdx = 0;

      for (let [pId, pRes] of this.allScenarioResults.entries()) {
        if (pId === 'baseline') continue;
        const comp = heor.computeComparativeHEOR(this.baselineResults.economicResults, pRes.economicResults);
        const presetObj = SCENARIO_PRESETS.find(x => x.id === pId);
        comparisonPts.push({
          label: presetObj ? presetObj.name.split(' (')[0] : pId,
          deltaCost: comp.deltaCost,
          dalysAverted: comp.dalysAverted,
          color: colors[cIdx % colors.length]
        });
        cIdx++;
      }

      this.chartRenderer.renderCEAPlane('ceaPlaneChart', comparisonPts, 7000);
    }

    // Tab 4: Budget Impact Analysis Tab
    if (this.activeTab === 'budget') {
      const biaYears = ['Yr 1', 'Yr 2', 'Yr 3', 'Yr 5', 'Yr 10', 'Yr 15', 'Yr 20'];
      const biaIndices = [0, 1, 2, 4, 9, 14, 19];

      const vacInvestment = biaIndices.map(i => actEco.annualOutcomes[i]?.costs.totalIntervention || 0);
      const treatmentSavings = biaIndices.map(i => {
        const baseCost = baseEco.annualOutcomes[i]?.costs.totalTreatment || 0;
        const actCost = actEco.annualOutcomes[i]?.costs.totalTreatment || 0;
        return baseCost - actCost;
      });

      this.chartRenderer.renderBarChart('budgetImpactBarChart', biaYears, [
        { label: 'Vaccine / Intervention Investment ($)', color: '#f59e0b', data: vacInvestment },
        { label: 'Treatment Cost Savings ($)', color: '#10b981', data: treatmentSavings }
      ], { formatY: val => `$${(val / 1e6).toFixed(1)}M` });
    }
  }

  renderComparisonTable() {
    const tbody = document.getElementById('comparisonTableBody');
    if (!tbody || !this.baselineResults) return;
    tbody.innerHTML = '';

    const heor = new HEOREngine();

    SCENARIO_PRESETS.forEach(p => {
      const res = this.allScenarioResults.get(p.id);
      if (!res) return;

      const comp = heor.computeComparativeHEOR(this.baselineResults.economicResults, res.economicResults);
      const tr = document.createElement('tr');
      if (p.id === this.currentPresetId) tr.className = 'highlight-row';

      const isBase = p.id === 'baseline';

      tr.innerHTML = `
        <td class="font-bold">${p.name}</td>
        <td>${isBase ? '-' : `${(comp.casesAverted / 1e6).toFixed(2)}M (${comp.pctCasesAverted.toFixed(1)}%)`}</td>
        <td>${isBase ? '-' : `${(comp.hospAverted / 1e3).toFixed(1)}k (${comp.pctHospAverted.toFixed(1)}%)`}</td>
        <td>${isBase ? '-' : `${(comp.dalysAverted / 1e3).toFixed(1)}k`}</td>
        <td>$${(res.economicResults.summary.totalDiscountedCost / 1e6).toFixed(1)}M</td>
        <td>${isBase ? '-' : `${comp.deltaCost < 0 ? '-' : '+'}$${Math.abs(comp.deltaCost / 1e6).toFixed(1)}M`}</td>
        <td>${isBase ? 'Reference' : (comp.deltaCost < 0 ? '<span class="tag-dominant">Dominant</span>' : `$${comp.icerPerDALY.toFixed(0)}`)}</td>
        <td>${isBase ? '-' : `$${comp.maxPriceCostEffective.toFixed(2)} / dose`}</td>
        <td>
          <button class="btn-table-apply" data-preset="${p.id}">Load Strategy</button>
        </td>
      `;

      tr.querySelector('.btn-table-apply')?.addEventListener('click', () => {
        this.selectPreset(p.id);
      });

      tbody.appendChild(tr);
    });
  }

  exportResultsToCSV() {
    if (!this.activeScenarioResults) return;
    const eco = this.activeScenarioResults.economicResults;
    const epi = this.activeScenarioResults.annualIncidences;

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Year,Total_Infections,Symptomatic_Cases,Hospitalized_Cases,Severe_Cases,Deaths,New_Vaccinated,Direct_Medical_Cost_USD,Indirect_Cost_USD,Vaccine_Cost_USD,Total_Cost_USD,DALYs\n';

    for (let yr = 0; yr < this.timeframe; yr++) {
      const out = eco.annualOutcomes[yr];
      csvContent += [
        yr + 1,
        out.infections.toFixed(0),
        out.symptomatic.toFixed(0),
        out.hospitalized.toFixed(0),
        out.severe.toFixed(0),
        out.deaths.toFixed(1),
        out.newVaccinated.toFixed(0),
        out.costs.directMedical.toFixed(2),
        out.costs.indirectProductivity.toFixed(2),
        out.costs.vaccineAcquisition.toFixed(2),
        out.costs.totalCost.toFixed(2),
        out.healthBurden.dalys.toFixed(2)
      ].join(',') + '\n';
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `dengue_dtm_results_${this.currentPresetId}_${this.timeframe}yr.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  exportResultsToJSON() {
    if (!this.activeScenarioResults) return;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.activeScenarioResults, null, 2));
    const link = document.createElement('a');
    link.setAttribute('href', dataStr);
    link.setAttribute('download', `dengue_dtm_scenario_${this.currentPresetId}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Instantiate and start app on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new DengueApp();
  app.init();
  window.dengueApp = app;
});
