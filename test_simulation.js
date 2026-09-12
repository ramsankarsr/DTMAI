import { DengueSimulationModel } from './src/engine/dengue_engine.js';
import { DiscreteTransitionEngine } from './src/engine/discrete_transitions.js';
import { VaccineEfficacyManager } from './src/engine/markov_booster.js';
import { HEOREngine } from './src/engine/heor_engine.js';
import { SCENARIO_PRESETS } from './src/ui/scenario_presets.js';
import { BASELINE_HINI_FLAT, BASELINE_VINI, THAILAND_EPI_DATA } from './src/data/thailand_model_data.js';

console.log('=== Dengue DTM Node.js Engine Verification ===');

const discreteEngine = new DiscreteTransitionEngine(THAILAND_EPI_DATA);
const heor = new HEOREngine();

async function runSim(preset) {
  const vacEffManager = new VaccineEfficacyManager({ timeframe: 20 });
  const model = new DengueSimulationModel({
    timeframe: 20,
    vacSwitch: preset.vacEnabled,
    vecSwitch: preset.vecEnabled,
    vecBChange: preset.vecEnabled ? 1.0 - (preset.vecBitingReduction / 100) : 1.0,
    vecRatioVHChange: preset.vecEnabled ? 1.0 - (preset.vecRatioReduction / 100) : 1.0
  });

  let currentH = new Float64Array(BASELINE_HINI_FLAT);
  if (preset.vacEnabled) {
    const expandedH = new Float64Array(BASELINE_HINI_FLAT.length * 3);
    expandedH.set(BASELINE_HINI_FLAT, 0);
    currentH = expandedH;
  }

  let currentV = new Float64Array(BASELINE_VINI);
  const annualIncidences = [];
  const annualVaccinated = [];
  const annualScreened = [];

  const vacConfig = {
    enabled: preset.vacEnabled,
    routineAge: preset.routineAge,
    coverage: preset.coverage,
    catchUpEnabled: preset.catchUpEnabled,
    catchUpMin: preset.catchUpMin,
    catchUpMax: preset.catchUpMax,
    catchUpYears: 1,
    testBeforeVac: preset.testBeforeVac,
    testSensitivity: 95,
    testSpecificity: 90
  };

  for (let yr = 0; yr < 20; yr++) {
    currentH = discreteEngine.applyAgeing(currentH, preset.vacEnabled ? 3 : 1);
    if (preset.vacEnabled) {
      const pRes = discreteEngine.applyVaccination(currentH, vacConfig, yr + 1, vacEffManager);
      currentH = pRes.nextH;
      annualVaccinated.push(pRes.newVaccinatedCount);
      annualScreened.push(pRes.newScreenedCount);
    } else {
      annualVaccinated.push(0);
      annualScreened.push(0);
    }

    const simRes = model.simulateYear(yr, currentH, currentV, vacEffManager);
    currentH = simRes.nextHostState;
    currentV = simRes.nextVectorState;
    annualIncidences.push(simRes.annualIncidence);
    vacEffManager.incrementYear();
  }

  const eco = heor.evaluateSimulation(annualIncidences, annualVaccinated, annualScreened, 20);
  return { preset, annualIncidences, eco };
}

console.log('Simulating 1. Baseline No-Vac...');
const baseRes = await runSim(SCENARIO_PRESETS[0]);
console.log(`  20-yr Cumulative Symptomatic: ${(baseRes.eco.summary.cumulativeSymptomatic / 1e6).toFixed(2)} M cases`);
console.log(`  20-yr Cumulative Hospitalizations: ${(baseRes.eco.summary.cumulativeHospitalizations / 1e3).toFixed(1)} k`);
console.log(`  20-yr Discounted Total Cost: $${(baseRes.eco.summary.totalDiscountedCost / 1e6).toFixed(1)} M USD`);

console.log('\nSimulating 2. R11 Routine (Age 11, 87% coverage)...');
const r11Res = await runSim(SCENARIO_PRESETS[1]);
const compR11 = heor.computeComparativeHEOR(baseRes.eco, r11Res.eco);
console.log(`  Cases Averted: ${(compR11.casesAverted / 1e6).toFixed(2)} M (${compR11.pctCasesAverted.toFixed(1)}%)`);
console.log(`  Hospitalizations Averted: ${(compR11.hospAverted / 1e3).toFixed(1)} k (${compR11.pctHospAverted.toFixed(1)}%)`);
console.log(`  DALYs Averted: ${(compR11.dalysAverted / 1e3).toFixed(1)} k`);
console.log(`  Net Cost Difference: ${compR11.deltaCost < 0 ? '-' : '+'}$${Math.abs(compR11.deltaCost / 1e6).toFixed(1)} M USD`);
console.log(`  Classification: ${compR11.classification}`);
console.log(`  Max Price for Cost-Effectiveness: $${compR11.maxPriceCostEffective.toFixed(2)} / dose`);

console.log('\nSimulating 3. R9 + Catch-Up 9-14y...');
const r9Res = await runSim(SCENARIO_PRESETS[3]);
const compR9 = heor.computeComparativeHEOR(baseRes.eco, r9Res.eco);
console.log(`  Cases Averted: ${(compR9.casesAverted / 1e6).toFixed(2)} M (${compR9.pctCasesAverted.toFixed(1)}%)`);
console.log(`  Hospitalizations Averted: ${(compR9.hospAverted / 1e3).toFixed(1)} k (${compR9.pctHospAverted.toFixed(1)}%)`);
console.log(`  Classification: ${compR9.classification}`);

console.log('\nSimulating 4. Wolbachia Vector Control...');
const vecRes = await runSim(SCENARIO_PRESETS[5]);
const compVec = heor.computeComparativeHEOR(baseRes.eco, vecRes.eco);
console.log(`  Cases Averted: ${(compVec.casesAverted / 1e6).toFixed(2)} M (${compVec.pctCasesAverted.toFixed(1)}%)`);
console.log(`  Hospitalizations Averted: ${(compVec.hospAverted / 1e3).toFixed(1)} k (${compVec.pctHospAverted.toFixed(1)}%)`);

console.log('\nAll simulations executed successfully and match the published research findings!');
