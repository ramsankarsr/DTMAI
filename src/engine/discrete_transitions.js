/**
 * PROJECT: Dengue Dynamic Transmission & HEOR Model (Dengue DTM 2025)
 * DESCRIPTION: Discrete Demographic Ageing & Vaccination Pulse Engine
 * REPLICATING: 31_age_vac_wrapper.R, 32_ageing.R, 33_vaccination.R
 */

import { NUM_AGES, TOTAL_STATES_PER_AGE } from './dengue_engine.js';
import { THAILAND_EPI_DATA } from '../data/thailand_model_data.js';

export class DiscreteTransitionEngine {
  constructor(epiData = THAILAND_EPI_DATA) {
    this.mortality = new Float64Array(epiData.mortality_model || new Array(NUM_AGES).fill(0.005));
    this.initialBirthRate = (epiData.pop_size_model ? epiData.pop_size_model[0] : 871951.9) * (this.mortality[0] || 0.0076);
  }

  /**
   * Apply annual demographic ageing across all 101 age cohorts
   * Age a (0..99) moves to a+1; Age 100 stays at 100 with combined mortality.
   * Newborn cohort (Age 0) is replenished by births.
   */
  applyAgeing(yH, vacLevels = 1) {
    const nextH = new Float64Array(yH.length);

    for (let v = 0; v < vacLevels; v++) {
      const vOffset = v * NUM_AGES * TOTAL_STATES_PER_AGE;

      // Ageing from 0..99 -> 1..100
      for (let a = 0; a < NUM_AGES - 1; a++) {
        const fromOffset = vOffset + a * TOTAL_STATES_PER_AGE;
        const toOffset = vOffset + (a + 1) * TOTAL_STATES_PER_AGE;
        const survival = Math.max(0.0, 1.0 - this.mortality[a]);

        for (let s = 0; s < TOTAL_STATES_PER_AGE; s++) {
          nextH[toOffset + s] = yH[fromOffset + s] * survival;
        }
      }

      // Oldest age cohort 100 accumulates remaining survivors
      const oldOffset = vOffset + (NUM_AGES - 1) * TOTAL_STATES_PER_AGE;
      const oldSurvival = Math.max(0.0, 1.0 - this.mortality[NUM_AGES - 1]);
      for (let s = 0; s < TOTAL_STATES_PER_AGE; s++) {
        nextH[oldOffset + s] += yH[oldOffset + s] * oldSurvival;
      }

      // Newborns for Unvaccinated (v = 0)
      if (v === 0) {
        // Susceptible to all 4 serotypes (state index 0: S,S,S,S)
        const newbornCount = THAILAND_EPI_DATA.pop_size_model ? THAILAND_EPI_DATA.pop_size_model[0] : 871951.9;
        nextH[vOffset + 0] = newbornCount;
      }
    }

    return nextH;
  }

  /**
   * Apply annual pulse vaccination
   * @param {Float64Array} yH - Host state vector
   * @param {Object} vacConfig - Strategy parameters { routineAge, coverage, catchUpMin, catchUpMax, catchUpDuration, testBeforeVac, sensitivity, specificity }
   * @param {number} year - Current simulation year (1..timeframe)
   * @param {VaccineEfficacyManager} vacEffManager - Tracker for cohorts
   */
  applyVaccination(yH, vacConfig, year, vacEffManager) {
    if (!vacConfig || !vacConfig.enabled) {
      return {
        nextH: yH,
        newVaccinatedCount: 0,
        newScreenedCount: 0,
        vaccinatedByAge: new Float64Array(NUM_AGES)
      };
    }

    const nextH = new Float64Array(yH);
    const unvacOffset = 0;
    const vacNegOffset = 1 * NUM_AGES * TOTAL_STATES_PER_AGE;
    const vacPosOffset = 2 * NUM_AGES * TOTAL_STATES_PER_AGE;

    let newVaccinatedCount = 0;
    let newScreenedCount = 0;
    const vaccinatedByAge = new Float64Array(NUM_AGES);

    const routineAge = vacConfig.routineAge ?? 11;
    const coverage = (vacConfig.coverage ?? 87) / 100.0;
    const catchUpMin = vacConfig.catchUpMin ?? 6;
    const catchUpMax = vacConfig.catchUpMax ?? 14;
    const catchUpYears = vacConfig.catchUpYears ?? 1; // 1-year pulse campaign
    const hasCatchUp = vacConfig.catchUpEnabled && year <= catchUpYears;

    const testBeforeVac = vacConfig.testBeforeVac ?? false;
    const sensitivity = (vacConfig.testSensitivity ?? 95) / 100.0;
    const specificity = (vacConfig.testSpecificity ?? 90) / 100.0;

    // Loop through all ages to apply routine and/or catch-up
    for (let a = 0; a < NUM_AGES; a++) {
      let isTarget = false;
      if (a === routineAge) isTarget = true;
      if (hasCatchUp && a >= catchUpMin && a <= catchUpMax) isTarget = true;

      if (!isTarget) continue;

      const aUnvacOffset = unvacOffset + a * TOTAL_STATES_PER_AGE;
      const aVacNegOffset = vacNegOffset + a * TOTAL_STATES_PER_AGE;
      const aVacPosOffset = vacPosOffset + a * TOTAL_STATES_PER_AGE;

      // Track total unvac hosts at this age
      let totalUnvacAtAge = 0;
      for (let s = 0; s < TOTAL_STATES_PER_AGE; s++) {
        totalUnvacAtAge += nextH[aUnvacOffset + s];
      }

      if (totalUnvacAtAge <= 0) continue;

      // Number screened
      const screenedAtAge = totalUnvacAtAge * coverage;
      newScreenedCount += screenedAtAge;

      let vaccinatedAtAge = 0;

      for (let j = 0; j < 5; j++) {
        for (let k = 0; k < 5; k++) {
          for (let l = 0; l < 5; l++) {
            for (let m = 0; m < 5; m++) {
              const stateIdx = j * 125 + k * 25 + l * 5 + m;
              const count = nextH[aUnvacOffset + stateIdx];
              if (count <= 0) continue;

              const isTrueSeronegative = (j === 0 && k === 0 && l === 0 && m === 0);
              const isTrueSeropositive = !isTrueSeronegative;

              let vacProb = coverage;
              let targetVacStatus = isTrueSeronegative ? 1 : 2; // 1: neg, 2: pos

              if (testBeforeVac) {
                // If screening test required: only test-positives receive vaccine
                if (isTrueSeropositive) {
                  vacProb = coverage * sensitivity; // True Positive
                  targetVacStatus = 2;
                } else {
                  vacProb = coverage * (1.0 - specificity); // False Positive
                  targetVacStatus = 1;
                }
              }

              const numToVaccinate = count * vacProb;
              if (numToVaccinate > 0) {
                nextH[aUnvacOffset + stateIdx] -= numToVaccinate;
                if (targetVacStatus === 1) {
                  nextH[aVacNegOffset + stateIdx] += numToVaccinate;
                } else {
                  nextH[aVacPosOffset + stateIdx] += numToVaccinate;
                }
                vaccinatedAtAge += numToVaccinate;
              }
            }
          }
        }
      }

      newVaccinatedCount += vaccinatedAtAge;
      vaccinatedByAge[a] = vaccinatedAtAge;

      // Register new cohort in Markov trace manager
      if (vacEffManager && vaccinatedAtAge > 0) {
        const cohortId = `cohort_age${a}_yr${year}`;
        vacEffManager.registerVaccinatedCohort(cohortId, a, year);
      }
    }

    return {
      nextH,
      newVaccinatedCount,
      newScreenedCount,
      vaccinatedByAge
    };
  }
}
