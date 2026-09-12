/**
 * PROJECT: Dengue Dynamic Transmission & HEOR Model (Dengue DTM 2025)
 * DESCRIPTION: Markov Tunnel State & Breakthrough Boosting Engine for Vaccine Protection
 * REPLICATING: 22_parms_vac_eff.R, Model_FillTrace, Model_UpdateTrace
 */

import { TAK003_VAC_EFF_DATA } from '../data/thailand_model_data.js';

export class VaccineEfficacyManager {
  constructor(config = {}) {
    this.rawVacData = { ...TAK003_VAC_EFF_DATA, ...config.vacData };
    this.boostingSymptomaticSwitch = config.boostingSymptomaticSwitch ?? true;
    this.boostingAsymptomaticSwitch = config.boostingAsymptomaticSwitch ?? false;
    this.symptBecomesAsympt = config.symptBecomesAsympt ?? true;
    this.timeframe = config.timeframe || 30;

    // Cohort tracking state: cohortKey -> { ageAtVac, yearOfVac, currentEpisode, yearsSinceLastBoost }
    this.cohortTraces = new Map();
    
    // Pre-extract 30-year efficacy curves for fast access
    this.curves = this._extractEfficacyCurves();
  }

  _extractEfficacyCurves() {
    const curves = {
      neg: {
        denv1: {
          ep1: this.rawVacData.eff_sympt_non_hosp_denv1_neg_ep1 || [],
          ep2: this.rawVacData.eff_sympt_non_hosp_denv1_neg_ep2 || [],
          ep3: this.rawVacData.eff_sympt_non_hosp_denv1_neg_ep3 || [],
          ep4: this.rawVacData.eff_sympt_non_hosp_denv1_neg_ep4 || []
        },
        denv2: {
          ep1: this.rawVacData.eff_sympt_non_hosp_denv2_neg_ep1 || [],
          ep2: this.rawVacData.eff_sympt_non_hosp_denv2_neg_ep2 || [],
          ep3: this.rawVacData.eff_sympt_non_hosp_denv2_neg_ep3 || [],
          ep4: this.rawVacData.eff_sympt_non_hosp_denv2_neg_ep4 || []
        },
        denv3: {
          ep1: this.rawVacData.eff_sympt_non_hosp_denv3_neg_ep1 || [],
          ep2: this.rawVacData.eff_sympt_non_hosp_denv3_neg_ep2 || [],
          ep3: this.rawVacData.eff_sympt_non_hosp_denv3_neg_ep3 || [],
          ep4: this.rawVacData.eff_sympt_non_hosp_denv3_neg_ep4 || []
        },
        denv4: {
          ep1: this.rawVacData.eff_sympt_non_hosp_denv4_neg_ep1 || [],
          ep2: this.rawVacData.eff_sympt_non_hosp_denv4_neg_ep2 || [],
          ep3: this.rawVacData.eff_sympt_non_hosp_denv4_neg_ep3 || [],
          ep4: this.rawVacData.eff_sympt_non_hosp_denv4_neg_ep4 || []
        }
      },
      pos: {
        denv1: {
          ep1: this.rawVacData.eff_sympt_non_hosp_denv1_pos_ep1 || [],
          ep2: this.rawVacData.eff_sympt_non_hosp_denv1_pos_ep2 || [],
          ep3: this.rawVacData.eff_sympt_non_hosp_denv1_pos_ep3 || [],
          ep4: this.rawVacData.eff_sympt_non_hosp_denv1_pos_ep4 || []
        },
        denv2: {
          ep1: this.rawVacData.eff_sympt_non_hosp_denv2_pos_ep1 || [],
          ep2: this.rawVacData.eff_sympt_non_hosp_denv2_pos_ep2 || [],
          ep3: this.rawVacData.eff_sympt_non_hosp_denv2_pos_ep3 || [],
          ep4: this.rawVacData.eff_sympt_non_hosp_denv2_pos_ep4 || []
        },
        denv3: {
          ep1: this.rawVacData.eff_sympt_non_hosp_denv3_pos_ep1 || [],
          ep2: this.rawVacData.eff_sympt_non_hosp_denv3_pos_ep2 || [],
          ep3: this.rawVacData.eff_sympt_non_hosp_denv3_pos_ep3 || [],
          ep4: this.rawVacData.eff_sympt_non_hosp_denv3_pos_ep4 || []
        },
        denv4: {
          ep1: this.rawVacData.eff_sympt_non_hosp_denv4_pos_ep1 || [],
          ep2: this.rawVacData.eff_sympt_non_hosp_denv4_pos_ep2 || [],
          ep3: this.rawVacData.eff_sympt_non_hosp_denv4_pos_ep3 || [],
          ep4: this.rawVacData.eff_sympt_non_hosp_denv4_pos_ep4 || []
        }
      }
    };

    return curves;
  }

  registerVaccinatedCohort(cohortId, ageAtVac, yearOfVac) {
    this.cohortTraces.set(cohortId, {
      ageAtVac,
      yearOfVac,
      currentEpisode: 1, // Start at episode 1 post-vaccination
      yearsSinceLastBoost: 0
    });
  }

  getEfficacy(currentAge, serotypeIdx, isSeropositiveAtVac, currentYear) {
    const seroKeys = ['denv1', 'denv2', 'denv3', 'denv4'];
    const seroKey = seroKeys[serotypeIdx] || 'denv1';
    const statusKey = isSeropositiveAtVac ? 'pos' : 'neg';

    // Find the cohort that matches current age
    let yearsElapsed = 0;
    let episode = 'ep1';

    for (let [_, cohort] of this.cohortTraces.entries()) {
      const cohortCurrentAge = cohort.ageAtVac + (currentYear - cohort.yearOfVac);
      if (cohortCurrentAge === currentAge && currentYear >= cohort.yearOfVac) {
        yearsElapsed = currentYear - cohort.yearOfVac;
        episode = `ep${Math.min(4, cohort.currentEpisode)}`;
        break;
      }
    }

    const curve = this.curves[statusKey][seroKey][episode];
    if (curve && curve.length > 0) {
      const idx = Math.min(curve.length - 1, Math.max(0, yearsElapsed));
      return curve[idx] || 0.0;
    }

    // Default fallback based on clinical trial 4.5 year follow up data:
    // Seropositive: ~75% initial, wanes to ~35%
    // Seronegative: ~55% initial, wanes to ~25%
    const baseInitial = isSeropositiveAtVac ? 0.72 : 0.56;
    const decay = Math.exp(-0.06 * Math.max(0, yearsElapsed));
    return Math.max(0.15, baseInitial * decay);
  }

  getHospEfficacy(currentAge, serotypeIdx, isSeropositiveAtVac, currentYear) {
    // TAK-003 exhibits higher protective efficacy against hospitalization (~85-90% initial)
    const baseEff = this.getEfficacy(currentAge, serotypeIdx, isSeropositiveAtVac, currentYear);
    return Math.min(0.98, baseEff * 1.35 + 0.15);
  }

  applyBreakthroughNaturalBoosting(cohortId) {
    if (!this.boostingSymptomaticSwitch) return;
    const cohort = this.cohortTraces.get(cohortId);
    if (cohort) {
      cohort.currentEpisode = Math.min(4, cohort.currentEpisode + 1);
      cohort.yearsSinceLastBoost = 0; // Reset tunnel state to year 1 of the new boosted curve
    }
  }

  incrementYear() {
    for (let [_, cohort] of this.cohortTraces.entries()) {
      cohort.yearsSinceLastBoost += 1;
    }
  }
}
