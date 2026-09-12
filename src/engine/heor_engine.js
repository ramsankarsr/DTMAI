/**
 * PROJECT: Dengue Dynamic Transmission & HEOR Model (Dengue DTM 2025)
 * DESCRIPTION: Health Economics and Outcomes Research (HEOR) Engine
 * REPLICATING: 51_module_eco.R, 25_parms_cost.R, 26_parms_QoL.R, S1/S2/S3 Materials
 */

import { THAILAND_COST_TTT, THAILAND_COST_VAC, THAILAND_QOL_DATA, THAILAND_EPI_DATA } from '../data/thailand_model_data.js';

export class HEOREngine {
  constructor(customParams = {}) {
    this.costTttData = customParams.costTtt || THAILAND_COST_TTT;
    this.costVacData = { ...THAILAND_COST_VAC, ...customParams.costVac };
    this.qolData = { ...THAILAND_QOL_DATA, ...customParams.qol };
    this.lifeExpectancy = new Float64Array(THAILAND_EPI_DATA.life_expectancy || new Array(101).fill(75));

    // Perspectives & Parameters
    this.discountRate = (customParams.discountRate ?? 3.0) / 100.0; // 3% annual discount rate
    this.wtpThreshold = customParams.wtpThreshold || 7000; // $7,000 USD (1x Thailand GDP per capita)
    this.perspective = customParams.perspective || 'societal'; // 'societal' or 'payer'
    this.vaccinePricePerDose = customParams.vaccinePricePerDose ?? (this.costVacData.cost_vaccine_per_dose || 30.0);
    this.vaccineAdminCost = customParams.vaccineAdminCost ?? (this.costVacData.cost_admin_per_dose || 2.30);
    this.vaccineDoses = customParams.vaccineDoses ?? (this.costVacData.nb_doses || 2);
    this.screeningCostPerCapita = customParams.screeningCostPerCapita ?? (this.costVacData.cost_screening_per_capita || 0.0);
    this.annualVectorControlCost = customParams.annualVectorControlCost || 0.0;
  }

  /**
   * Evaluates comprehensive economic and clinical outcomes over simulation timeframe
   */
  evaluateSimulation(annualIncidences, annualVaccinatedData, annualScreenedData, timeframe = 20) {
    const annualOutcomes = [];

    let totalUndiscountedCost = 0;
    let totalDiscountedCost = 0;
    let totalUndiscountedDALYs = 0;
    let totalDiscountedDALYs = 0;
    let totalUndiscountedQALYLoss = 0;
    let totalDiscountedQALYLoss = 0;

    let cumulativeInfections = 0;
    let cumulativeSymptomatic = 0;
    let cumulativeHospitalizations = 0;
    let cumulativeSevereCases = 0;
    let cumulativeDeaths = 0;

    for (let yr = 0; yr < timeframe; yr++) {
      const inc = annualIncidences[yr];
      const discountFactor = Math.pow(1.0 + this.discountRate, -yr);

      // 1. Treatment Cost Calculations
      let medCost = 0;
      let nonMedCost = 0;
      let indirectCost = 0;
      let absenteeismCost = 0;
      let persistentCost = 0;

      // Severity counts for this year
      const asympt = inc.bySeverity[0];
      const nonHospMild = inc.bySeverity[1];
      const hospMild = inc.bySeverity[2];
      const nonHospSevere = inc.bySeverity[3];
      const hospSevere = inc.bySeverity[4];
      const deaths = inc.bySeverity[5];

      // Use age-stratified cost coefficients from Thailand study (CostTtt_00001.csv)
      for (let a = 0; a < 101; a++) {
        const ageInc = inc.byAgeAndSeverity[a];
        const ageNonHosp = ageInc[1] + ageInc[3];
        const ageHospMild = ageInc[2];
        const ageHospSevere = ageInc[4] + ageInc[5];

        // Match economic age bracket (0-5, 6-15, 16-17, 18-29, 30-59, 60+)
        const ecoGroup = this._getEcoGroup(a);

        // Direct Medical
        const unitMedNonHosp = ecoGroup.costs_non_hosp_med || 70.91;
        const unitMedHospMild = ecoGroup.costs_hosp_mild_med || 657.76;
        const unitMedHospSevere = ecoGroup.costs_hosp_severe_med || 1114.73;

        // Persistent dengue sequelae
        const longTermProp = ecoGroup.long_term_proportion || 0.0948; // 9.48% persistent dengue
        const longTermCost = ecoGroup.long_term_cost || 14.99;
        const longTermDur = this.qolData.dur_long_term || 2.688; // ~2.7 years

        const persistentMed = (ageNonHosp + ageHospMild + ageInc[4]) * (longTermProp * longTermCost * longTermDur);

        medCost += (ageNonHosp * unitMedNonHosp) + (ageHospMild * unitMedHospMild) + (ageHospSevere * unitMedHospSevere) + persistentMed;
        persistentCost += persistentMed;

        // Direct Non-Medical (Societal perspective only)
        if (this.perspective === 'societal') {
          const unitNonMedNonHosp = ecoGroup.costs_non_hosp_non_med || 17.76;
          const unitNonMedHospMild = ecoGroup.costs_hosp_mild_non_med || 80.56;
          const unitNonMedHospSevere = ecoGroup.costs_hosp_severe_non_med || 80.56;

          nonMedCost += (ageNonHosp * unitNonMedNonHosp) + (ageHospMild * unitNonMedHospMild) + (ageHospSevere * unitNonMedHospSevere);

          // Indirect Productivity Losses (Lost wages)
          const incomeLostNonHosp = ecoGroup.income_lost_non_hosp || 62.08;
          const incomeLostHospMild = ecoGroup.income_lost_hosp_mild || 93.11;
          const incomeLostHospSevere = ecoGroup.income_lost_hosp_severe || 127.26;

          indirectCost += (ageNonHosp * incomeLostNonHosp) + (ageHospMild * incomeLostHospMild) + (ageHospSevere * incomeLostHospSevere);

          // School absenteeism
          const schoolCostPerDay = ecoGroup.absenteeism_cost || 2.53;
          const sdLostNonHosp = ecoGroup.sd_lost_non_hosp || 0.0;
          const sdLostHospMild = ecoGroup.sd_lost_hosp_mild || 0.0;
          const sdLostHospSevere = ecoGroup.sd_lost_hosp_severe || 0.0;

          absenteeismCost += ((ageNonHosp * sdLostNonHosp) + (ageHospMild * sdLostHospMild) + (ageHospSevere * sdLostHospSevere)) * schoolCostPerDay;
        }
      }

      // 2. Intervention Costs (Vaccination & Vector Control)
      const numVaccinated = annualVaccinatedData[yr] || 0;
      const numScreened = annualScreenedData[yr] || 0;

      const vaccineAcquisitionCost = numVaccinated * this.vaccineDoses * this.vaccinePricePerDose;
      const vaccineAdminCost = numVaccinated * this.vaccineDoses * this.vaccineAdminCost;
      const screeningCost = numScreened * this.screeningCostPerCapita;
      const totalVacCost = vaccineAcquisitionCost + vaccineAdminCost + screeningCost;

      const vectorControlCost = this.annualVectorControlCost;

      // Total Year Cost
      const totalTreatmentCost = medCost + nonMedCost + indirectCost + absenteeismCost;
      const totalInterventionCost = totalVacCost + vectorControlCost;
      const totalYearCost = totalTreatmentCost + totalInterventionCost;

      // 3. Health Outcomes & DALY Calculations (Global Burden of Disease methodology)
      // DALY = YLL (Years of Life Lost) + YLD (Years Lived with Disability)
      const dwMild = this.qolData.disab_weight_mild || 0.197;
      const dwSevere = this.qolData.disab_weight_severe || 0.545;
      const dwLongTerm = this.qolData.disab_weight_long_term || 0.219;

      const durMildYears = (this.qolData.disab_dur_mild || 6.0) / 365.0; // 6 days
      const durSevereYears = (this.qolData.disab_dur_severe || 14.0) / 365.0; // 14 days
      const durLongTermYears = this.qolData.dur_long_term || 2.688; // 2.688 years

      // YLD
      const yldMild = (nonHospMild + hospMild) * dwMild * durMildYears;
      const yldSevere = (nonHospSevere + hospSevere) * dwSevere * durSevereYears;
      const yldPersistent = (nonHospMild + hospMild + hospSevere) * 0.0948 * dwLongTerm * durLongTermYears;
      const totalYLD = yldMild + yldSevere + yldPersistent;

      // YLL (Deaths * remaining life expectancy at age of death)
      let totalYLL = 0;
      for (let a = 0; a < 101; a++) {
        const ageDeaths = inc.byAgeAndSeverity[a][5];
        const remLifeExp = this.lifeExpectancy[a] || Math.max(1, 75 - a);
        totalYLL += ageDeaths * remLifeExp;
      }

      const totalYearDALYs = totalYLL + totalYLD;
      const totalYearQALYLoss = totalYearDALYs; // In standard HEOR models, QALY loss corresponds closely to DALY burden

      // Discounting
      const discountedCost = totalYearCost * discountFactor;
      const discountedDALYs = totalYearDALYs * discountFactor;
      const discountedQALYLoss = totalYearQALYLoss * discountFactor;

      totalUndiscountedCost += totalYearCost;
      totalDiscountedCost += discountedCost;
      totalUndiscountedDALYs += totalYearDALYs;
      totalDiscountedDALYs += discountedDALYs;
      totalUndiscountedQALYLoss += totalYearQALYLoss;
      totalDiscountedQALYLoss += discountedQALYLoss;

      cumulativeInfections += inc.totalInfections;
      cumulativeSymptomatic += inc.totalSymptomatic;
      cumulativeHospitalizations += inc.totalHospitalized;
      cumulativeSevereCases += inc.totalSevere;
      cumulativeDeaths += inc.totalDeaths;

      annualOutcomes.push({
        year: yr + 1,
        infections: inc.totalInfections,
        symptomatic: inc.totalSymptomatic,
        hospitalized: inc.totalHospitalized,
        severe: inc.totalSevere,
        deaths: inc.totalDeaths,
        newVaccinated: numVaccinated,
        newScreened: numScreened,
        costs: {
          directMedical: medCost,
          directNonMedical: nonMedCost,
          indirectProductivity: indirectCost,
          schoolAbsenteeism: absenteeismCost,
          persistentDengue: persistentCost,
          vaccineAcquisition: vaccineAcquisitionCost,
          vaccineAdmin: vaccineAdminCost,
          screening: screeningCost,
          vectorControl: vectorControlCost,
          totalTreatment: totalTreatmentCost,
          totalIntervention: totalInterventionCost,
          totalCost: totalYearCost,
          discountedTotalCost: discountedCost
        },
        healthBurden: {
          yll: totalYLL,
          yld: totalYLD,
          dalys: totalYearDALYs,
          discountedDALYs: discountedDALYs,
          qalyLoss: totalYearQALYLoss,
          discountedQALYLoss: discountedQALYLoss
        }
      });
    }

    return {
      annualOutcomes,
      summary: {
        totalUndiscountedCost,
        totalDiscountedCost,
        totalUndiscountedDALYs,
        totalDiscountedDALYs,
        totalUndiscountedQALYLoss,
        totalDiscountedQALYLoss,
        cumulativeInfections,
        cumulativeSymptomatic,
        cumulativeHospitalizations,
        cumulativeSevereCases,
        cumulativeDeaths
      }
    };
  }

  _getEcoGroup(age) {
    if (age <= 5) return this.costTttData[0] || {};
    if (age <= 15) return this.costTttData[1] || {};
    if (age <= 17) return this.costTttData[2] || {};
    if (age <= 29) return this.costTttData[3] || {};
    if (age <= 59) return this.costTttData[4] || {};
    return this.costTttData[5] || {};
  }

  /**
   * Calculates Incremental Cost-Effectiveness Ratio (ICER) comparing Strategy vs Baseline
   */
  computeComparativeHEOR(baselineResults, strategyResults) {
    const deltaCost = strategyResults.summary.totalDiscountedCost - baselineResults.summary.totalDiscountedCost;
    const dalysAverted = baselineResults.summary.totalDiscountedDALYs - strategyResults.summary.totalDiscountedDALYs;
    const qalysGained = baselineResults.summary.totalDiscountedQALYLoss - strategyResults.summary.totalDiscountedQALYLoss;

    const casesAverted = baselineResults.summary.cumulativeSymptomatic - strategyResults.summary.cumulativeSymptomatic;
    const hospAverted = baselineResults.summary.cumulativeHospitalizations - strategyResults.summary.cumulativeHospitalizations;
    const deathsAverted = baselineResults.summary.cumulativeDeaths - strategyResults.summary.cumulativeDeaths;

    const pctCasesAverted = baselineResults.summary.cumulativeSymptomatic > 0 
      ? (casesAverted / baselineResults.summary.cumulativeSymptomatic) * 100.0 
      : 0;
    const pctHospAverted = baselineResults.summary.cumulativeHospitalizations > 0 
      ? (hospAverted / baselineResults.summary.cumulativeHospitalizations) * 100.0 
      : 0;

    // ICER = Delta Cost / DALYs Averted
    let icerPerDALY = dalysAverted > 0 ? deltaCost / dalysAverted : Infinity;
    let icerPerQALY = qalysGained > 0 ? deltaCost / qalysGained : Infinity;

    // Net Monetary Benefit: NMB = (WTP * Delta Effect) - Delta Cost
    const nmb = (this.wtpThreshold * dalysAverted) - deltaCost;

    // Classification:
    // 1. Dominant (Cost-saving and health-improving: deltaCost < 0 and dalysAverted > 0)
    // 2. Cost-Effective (ICER <= WTP threshold)
    // 3. Not Cost-Effective (ICER > WTP threshold)
    // 4. Dominated (Higher cost and worse health: deltaCost > 0 and dalysAverted <= 0)
    let classification = 'Not Cost-Effective';
    if (deltaCost < 0 && dalysAverted > 0) {
      classification = 'Dominant (Cost-Saving & Health-Improving)';
    } else if (dalysAverted > 0 && icerPerDALY <= this.wtpThreshold) {
      classification = 'Cost-Effective';
    } else if (deltaCost > 0 && dalysAverted <= 0) {
      classification = 'Dominated';
    }

    // Threshold Maximum Price per dose for dominance and cost-effectiveness
    // Total doses delivered over timeframe
    const totalDoses = strategyResults.annualOutcomes.reduce((acc, y) => acc + y.newVaccinated * this.vaccineDoses, 0);
    const treatmentCostSavings = baselineResults.summary.totalDiscountedCost - 
      strategyResults.annualOutcomes.reduce((acc, y) => acc + y.costs.totalTreatment * Math.pow(1 + this.discountRate, -(y.year - 1)), 0);

    let maxPriceDominant = 0;
    let maxPriceCostEffective = 0;

    if (totalDoses > 0) {
      // Dominant price: Vaccine acquisition cost = Treatment cost savings
      maxPriceDominant = Math.max(0, (treatmentCostSavings - (totalDoses * this.vaccineAdminCost)) / totalDoses);
      // Cost-effective price: Vaccine acquisition cost = Treatment cost savings + (WTP * DALYs Averted)
      maxPriceCostEffective = Math.max(0, (treatmentCostSavings + (this.wtpThreshold * dalysAverted) - (totalDoses * this.vaccineAdminCost)) / totalDoses);
    }

    return {
      deltaCost,
      dalysAverted,
      qalysGained,
      casesAverted,
      hospAverted,
      deathsAverted,
      pctCasesAverted,
      pctHospAverted,
      icerPerDALY,
      icerPerQALY,
      nmb,
      classification,
      maxPriceDominant,
      maxPriceCostEffective,
      wtpThreshold: this.wtpThreshold,
      totalDoses
    };
  }
}
