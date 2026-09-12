/**
 * PROJECT: Dengue Dynamic Transmission & HEOR Model (Dengue DTM 2025)
 * DESCRIPTION: High-Performance 4-Serotype Host-Vector SEIR Numerical Engine
 * REPLICATING: M1_no_vac.c, M2_vac.c, 01_model_run.R (Shen, Kharitonova et al., 2025)
 */

import { THAILAND_EPI_DATA, BASELINE_VINI, BASELINE_HINI_FLAT } from '../data/thailand_model_data.js';

export const NUM_AGES = 101;
export const NUM_SEROTYPES = 4;
export const NUM_STATES_PER_SERO = 5; // 1: S, 2: E, 3: I, 4: C, 5: R
export const TOTAL_STATES_PER_AGE = 625; // 5^4

/**
 * Precomputes index lookup tables for state indexing
 */
export class DengueIndexHelper {
  constructor() {
    this.pastInfectionsTable = new Int8Array(5 * 5 * 5 * 5);
    for (let j = 1; j <= 5; j++) {
      for (let k = 1; k <= 5; k++) {
        for (let l = 1; l <= 5; l++) {
          for (let m = 1; m <= 5; m++) {
            let idx = (j - 1) * 125 + (k - 1) * 25 + (l - 1) * 5 + (m - 1);
            let count = 0;
            if (j >= 2) count++;
            if (k >= 2) count++;
            if (l >= 2) count++;
            if (m >= 2) count++;
            this.pastInfectionsTable[idx] = count;
          }
        }
      }
    }
  }

  getHostIndex(age, j, k, l, m, vacStatus = 0) {
    const ageBlock = TOTAL_STATES_PER_AGE * NUM_AGES;
    return vacStatus * ageBlock + age * TOTAL_STATES_PER_AGE + (j * 125 + k * 25 + l * 5 + m);
  }

  getPastInfections(j, k, l, m) {
    return this.pastInfectionsTable[j * 125 + k * 25 + l * 5 + m];
  }
}

export const indexHelper = new DengueIndexHelper();

/**
 * Computes theta modifier for force of infection:
 * Handles impossibility of co-infection (E or I in other serotype -> theta=0),
 * Cross-protection (gammaCP), max infections limit, and ADE enhancement (gammaCE).
 */
export function computeTheta(k, l, m, gammaCP = 0.0, dzetaCE = 0, gammaCE = 1.0, maxInfections = 4, vaccineEfficacy = 0.0) {
  const klm = [k, l, m];
  let pastCount = 0;
  for (let s of klm) {
    if (s >= 1) pastCount++;
  }

  if (pastCount >= maxInfections) {
    return 0.0;
  }

  let sigmas = [
    1.0 - vaccineEfficacy,
    0.0,
    0.0,
    gammaCP,
    1.0 - vaccineEfficacy
  ];

  let minSigma = Math.min(sigmas[k], sigmas[l], sigmas[m]);

  if (dzetaCE !== 0 && minSigma > 0) {
    let numImmune = (k === 4 ? 1 : 0) + (l === 4 ? 1 : 0) + (m === 4 ? 1 : 0);
    let numSusc = (k === 0 ? 1 : 0) + (l === 0 ? 1 : 0) + (m === 0 ? 1 : 0);
    if (numImmune === 1 && numSusc === 2) {
      minSigma *= gammaCE;
    } else if (dzetaCE === 2 && numImmune >= 2) {
      minSigma *= gammaCE;
    }
  }

  return minSigma;
}

// Precompute state transitions and flags ONCE for all 625 states
export const STATE_INFO = new Array(TOTAL_STATES_PER_AGE);
for (let j = 0; j < 5; j++) {
  for (let k = 0; k < 5; k++) {
    for (let l = 0; l < 5; l++) {
      for (let m = 0; m < 5; m++) {
        const idx = j * 125 + k * 25 + l * 5 + m;
        const pastInfs = (j >= 1 ? 1 : 0) + (k >= 1 ? 1 : 0) + (l >= 1 ? 1 : 0) + (m >= 1 ? 1 : 0);
        STATE_INFO[idx] = {
          idx, j, k, l, m,
          pastInfs,
          infTypeIdx: Math.min(2, pastInfs),
          isInf0: j === 2,
          isInf1: k === 2,
          isInf2: l === 2,
          isInf3: m === 2,
          nextJ1: 1 * 125 + k * 25 + l * 5 + m,
          nextJ2: 2 * 125 + k * 25 + l * 5 + m,
          nextJ3: 3 * 125 + k * 25 + l * 5 + m,
          nextJ4: 4 * 125 + k * 25 + l * 5 + m,
          nextK1: j * 125 + 1 * 25 + l * 5 + m,
          nextK2: j * 125 + 2 * 25 + l * 5 + m,
          nextK3: j * 125 + 3 * 25 + l * 5 + m,
          nextK4: j * 125 + 4 * 25 + l * 5 + m,
          nextL1: j * 125 + k * 25 + 1 * 5 + m,
          nextL2: j * 125 + k * 25 + 2 * 5 + m,
          nextL3: j * 125 + k * 25 + 3 * 5 + m,
          nextL4: j * 125 + k * 25 + 4 * 5 + m,
          nextM1: j * 125 + k * 25 + l * 5 + 1,
          nextM2: j * 125 + k * 25 + l * 5 + 2,
          nextM3: j * 125 + k * 25 + l * 5 + 3,
          nextM4: j * 125 + k * 25 + l * 5 + 4
        };
      }
    }
  }
}

/**
 * Fast Vectorized Dengue Dynamic Model Simulator
 */
export class DengueSimulationModel {
  constructor(params = {}) {
    this.epi = { ...THAILAND_EPI_DATA, ...params.epi };
    this.timeframe = params.timeframe || 20;
    this.vacSwitch = params.vacSwitch ?? false;
    this.vecSwitch = params.vecSwitch ?? false;
    
    this.vecRatioVHChange = params.vecRatioVHChange ?? 1.0;
    this.vecBChange = params.vecBChange ?? 1.0;
    
    this.popSize = new Float64Array(this.epi.pop_size_model || this.epi.pop_size_real_model);
    this.totalPop = this.popSize.reduce((a, b) => a + b, 0);
    this.mortality = new Float64Array(this.epi.mortality_model);
    this.lifeExpectancy = new Float64Array(this.epi.life_expectancy);
    this.betaVH = new Float64Array(this.epi.betaVH || [0.08585, 0.08585, 0.08585, 0.08585]);
    this.betaHV = this.epi.betaHV || 0.3;
    this.b = (this.epi.b || 0.7) * (this.vecSwitch ? this.vecBChange : 1.0);
    this.ratioVH = (this.epi.ratio_VH || 2.0) * (this.vecSwitch ? this.vecRatioVHChange : 1.0);
    this.seasonP1 = this.epi.season_p1 || 0.34149;
    this.seasonP2 = this.epi.season_p2 || -0.51224;
    this.durLatencyH = this.epi.dur_latency_H || 5.0;
    this.durVirH = this.epi.dur_vir_H || 4.5;
    this.durLatencyV = this.epi.dur_latency_V || 10.0;
    this.leV = this.epi.LE_V || 14.0;
    this.durCP = this.epi.dur_CP_days || 182.0;
    this.gammaCP = this.epi.gammaCP || 0.0;
    this.gammaCE = this.epi.gammaCE || 1.0;
    this.dzetaCE = this.epi.dzetaCE || 0;

    this.dt = 1.0;
    this.xiH = 1.0 / this.durLatencyH;
    this.rhoH = 1.0 / this.durVirH;
    this.phiCP = 1.0 / this.durCP;
    this.xiV = 1.0 / this.durLatencyV;
    this.muV = 1.0 / this.leV;

    // Precomputed exact transition factors for latency, infectiousness, and cross-protection
    this.pTransXi = 1.0 - Math.exp(-this.xiH * this.dt);
    this.pTransRho = 1.0 - Math.exp(-this.rhoH * this.dt);
    this.pTransPhi = 1.0 - Math.exp(-this.phiCP * this.dt);

    this.betaVHAgeCoef = new Float64Array(this.epi.betaVH_age_coef || new Array(101).fill(1.0));
  }

  simulateYear(yearIdx, currentHostState, currentVectorState, vacEfficacies = null) {
    const dt = this.dt;
    const daysInYear = 365;
    const vacLevels = this.vacSwitch ? 3 : 1;
    
    let yH = new Float64Array(currentHostState);
    let yV = new Float64Array(currentVectorState);
    
    const annualIncidence = {
      bySerotype: new Float64Array(NUM_SEROTYPES),
      byType: new Float64Array(3),
      bySeverity: new Float64Array(6),
      byAge: new Float64Array(NUM_AGES),
      byAgeAndSeverity: Array.from({ length: NUM_AGES }, () => new Float64Array(6)),
      totalInfections: 0,
      totalSymptomatic: 0,
      totalHospitalized: 0,
      totalSevere: 0,
      totalDeaths: 0
    };

    const vectorCapacity = new Float64Array(daysInYear);
    for (let day = 0; day < daysInYear; day++) {
      const t = yearIdx * 365 + day;
      const seasonalMod = 1.0 + this.seasonP1 * Math.sin((2.0 * Math.PI * (t - this.seasonP2 * 365.0)) / 365.0);
      vectorCapacity[day] = Math.max(0.1, this.ratioVH * this.totalPop * seasonalMod);
    }

    const pTransXi = this.pTransXi;
    const pTransRho = this.pTransRho;
    const pTransPhi = this.pTransPhi;
    const totalPop = Math.max(1.0, this.totalPop);

    for (let day = 0; day < daysInYear; day++) {
      // 1. Calculate infectious host counts across active compartments
      const totalInfectiousH = new Float64Array(NUM_SEROTYPES);
      
      for (let v = 0; v < vacLevels; v++) {
        const vOffset = v * NUM_AGES * TOTAL_STATES_PER_AGE;
        for (let a = 0; a < NUM_AGES; a++) {
          const aOffset = vOffset + a * TOTAL_STATES_PER_AGE;
          for (let s = 0; s < TOTAL_STATES_PER_AGE; s++) {
            const count = yH[aOffset + s];
            if (count <= 0) continue;
            const info = STATE_INFO[s];
            if (info.isInf0) totalInfectiousH[0] += count;
            if (info.isInf1) totalInfectiousH[1] += count;
            if (info.isInf2) totalInfectiousH[2] += count;
            if (info.isInf3) totalInfectiousH[3] += count;
          }
        }
      }

      // 2. Vector Transmission ODE
      const foiV = new Float64Array(NUM_SEROTYPES);
      for (let s = 0; s < NUM_SEROTYPES; s++) {
        foiV[s] = this.b * this.betaHV * (totalInfectiousH[s] / totalPop);
      }

      const totV = vectorCapacity[day];
      const Sv = yV[0];
      const Ev = [yV[1], yV[2], yV[3], yV[4]];
      const Iv = [yV[5], yV[6], yV[7], yV[8]];

      let sumFoiV = foiV[0] + foiV[1] + foiV[2] + foiV[3];
      let dSv = this.muV * totV - sumFoiV * Sv - this.muV * Sv;
      
      let dEv = new Float64Array(NUM_SEROTYPES);
      let dIv = new Float64Array(NUM_SEROTYPES);

      for (let s = 0; s < NUM_SEROTYPES; s++) {
        dEv[s] = foiV[s] * Sv - (this.xiV + this.muV) * Ev[s];
        dIv[s] = this.xiV * Ev[s] - this.muV * Iv[s];
      }

      yV[0] = Math.max(0, Sv + dSv * dt);
      for (let s = 0; s < NUM_SEROTYPES; s++) {
        yV[1 + s] = Math.max(0, Ev[s] + dEv[s] * dt);
        yV[5 + s] = Math.max(0, Iv[s] + dIv[s] * dt);
      }

      // 3. Host FOI per age
      const foiH = Array.from({ length: NUM_AGES }, () => new Float64Array(NUM_SEROTYPES));
      for (let a = 0; a < NUM_AGES; a++) {
        const ageCoef = this.betaVHAgeCoef[a] || 1.0;
        for (let s = 0; s < NUM_SEROTYPES; s++) {
          foiH[a][s] = this.b * this.betaVH[s] * ageCoef * (yV[5 + s] / totalPop);
        }
      }

      // 4. Host state transitions using direct STATE_INFO lookups
      for (let v = 0; v < vacLevels; v++) {
        const vOffset = v * NUM_AGES * TOTAL_STATES_PER_AGE;
        const isVac = v > 0;
        const isSeropositiveAtVac = v === 2;

        for (let a = 0; a < NUM_AGES; a++) {
          const aOffset = vOffset + a * TOTAL_STATES_PER_AGE;
          const aFoiH = foiH[a];

          let eff0 = 0.0, eff1 = 0.0, eff2 = 0.0, eff3 = 0.0;
          if (isVac && vacEfficacies) {
            eff0 = vacEfficacies.getEfficacy(a, 0, isSeropositiveAtVac, yearIdx);
            eff1 = vacEfficacies.getEfficacy(a, 1, isSeropositiveAtVac, yearIdx);
            eff2 = vacEfficacies.getEfficacy(a, 2, isSeropositiveAtVac, yearIdx);
            eff3 = vacEfficacies.getEfficacy(a, 3, isSeropositiveAtVac, yearIdx);
          }
          
          for (let s = 0; s < TOTAL_STATES_PER_AGE; s++) {
            const count = yH[aOffset + s];
            if (count <= 1e-9) continue;
            const info = STATE_INFO[s];
            const infTypeIdx = info.infTypeIdx;

            // DENV-1 Transitions
            if (info.j === 0) {
              const theta = computeTheta(info.k, info.l, info.m, this.gammaCP, this.dzetaCE, this.gammaCE, 4, eff0);
              if (theta > 0) {
                const transRate = aFoiH[0] * theta;
                const newCases = count * (1.0 - Math.exp(-transRate * dt));
                if (newCases > 0) {
                  yH[aOffset + s] -= newCases;
                  yH[aOffset + info.nextJ1] += newCases;
                  this._recordIncidence(annualIncidence, 0, infTypeIdx, a, newCases, isVac, vacEfficacies, isSeropositiveAtVac, yearIdx);
                }
              }
            } else if (info.j === 1) {
              const trans = count * pTransXi;
              yH[aOffset + s] -= trans;
              yH[aOffset + info.nextJ2] += trans;
            } else if (info.j === 2) {
              const trans = count * pTransRho;
              yH[aOffset + s] -= trans;
              yH[aOffset + info.nextJ3] += trans;
            } else if (info.j === 3) {
              const trans = count * pTransPhi;
              yH[aOffset + s] -= trans;
              yH[aOffset + info.nextJ4] += trans;
            }

            // DENV-2 Transitions
            if (info.k === 0) {
              const theta = computeTheta(info.j, info.l, info.m, this.gammaCP, this.dzetaCE, this.gammaCE, 4, eff1);
              if (theta > 0) {
                const transRate = aFoiH[1] * theta;
                const newCases = count * (1.0 - Math.exp(-transRate * dt));
                if (newCases > 0) {
                  yH[aOffset + s] -= newCases;
                  yH[aOffset + info.nextK1] += newCases;
                  this._recordIncidence(annualIncidence, 1, infTypeIdx, a, newCases, isVac, vacEfficacies, isSeropositiveAtVac, yearIdx);
                }
              }
            } else if (info.k === 1) {
              const trans = count * pTransXi;
              yH[aOffset + s] -= trans;
              yH[aOffset + info.nextK2] += trans;
            } else if (info.k === 2) {
              const trans = count * pTransRho;
              yH[aOffset + s] -= trans;
              yH[aOffset + info.nextK3] += trans;
            } else if (info.k === 3) {
              const trans = count * pTransPhi;
              yH[aOffset + s] -= trans;
              yH[aOffset + info.nextK4] += trans;
            }

            // DENV-3 Transitions
            if (info.l === 0) {
              const theta = computeTheta(info.j, info.k, info.m, this.gammaCP, this.dzetaCE, this.gammaCE, 4, eff2);
              if (theta > 0) {
                const transRate = aFoiH[2] * theta;
                const newCases = count * (1.0 - Math.exp(-transRate * dt));
                if (newCases > 0) {
                  yH[aOffset + s] -= newCases;
                  yH[aOffset + info.nextL1] += newCases;
                  this._recordIncidence(annualIncidence, 2, infTypeIdx, a, newCases, isVac, vacEfficacies, isSeropositiveAtVac, yearIdx);
                }
              }
            } else if (info.l === 1) {
              const trans = count * pTransXi;
              yH[aOffset + s] -= trans;
              yH[aOffset + info.nextL2] += trans;
            } else if (info.l === 2) {
              const trans = count * pTransRho;
              yH[aOffset + s] -= trans;
              yH[aOffset + info.nextL3] += trans;
            } else if (info.l === 3) {
              const trans = count * pTransPhi;
              yH[aOffset + s] -= trans;
              yH[aOffset + info.nextL4] += trans;
            }

            // DENV-4 Transitions
            if (info.m === 0) {
              const theta = computeTheta(info.j, info.k, info.l, this.gammaCP, this.dzetaCE, this.gammaCE, 4, eff3);
              if (theta > 0) {
                const transRate = aFoiH[3] * theta;
                const newCases = count * (1.0 - Math.exp(-transRate * dt));
                if (newCases > 0) {
                  yH[aOffset + s] -= newCases;
                  yH[aOffset + info.nextM1] += newCases;
                  this._recordIncidence(annualIncidence, 3, infTypeIdx, a, newCases, isVac, vacEfficacies, isSeropositiveAtVac, yearIdx);
                }
              }
            } else if (info.m === 1) {
              const trans = count * pTransXi;
              yH[aOffset + s] -= trans;
              yH[aOffset + info.nextM2] += trans;
            } else if (info.m === 2) {
              const trans = count * pTransRho;
              yH[aOffset + s] -= trans;
              yH[aOffset + info.nextM3] += trans;
            } else if (info.m === 3) {
              const trans = count * pTransPhi;
              yH[aOffset + s] -= trans;
              yH[aOffset + info.nextM4] += trans;
            }
          }
        }
      }
    }

    return {
      nextHostState: yH,
      nextVectorState: yV,
      annualIncidence
    };
  }

  _recordIncidence(incidence, seroIdx, infTypeIdx, age, count, isVac, vacEfficacies, isSeropositiveAtVac, yearIdx) {
    incidence.bySerotype[seroIdx] += count;
    incidence.byType[infTypeIdx] += count;
    incidence.byAge[age] += count;
    incidence.totalInfections += count;

    const propSymptTable = [0.30, 0.60, 0.10];
    let propSympt = propSymptTable[infTypeIdx];

    const propHospTable = [0.1594, 0.3002, 0.0747];
    let propHosp = propHospTable[infTypeIdx];

    const propSevereTable = [0.06285, 0.11834, 0.02944];
    let propSevere = propSevereTable[infTypeIdx];

    const propDeath = 0.002591;

    if (isVac && vacEfficacies) {
      const hospEff = vacEfficacies.getHospEfficacy(age, seroIdx, isSeropositiveAtVac, yearIdx);
      propHosp *= Math.max(0.05, 1.0 - hospEff);
      propSevere *= Math.max(0.05, 1.0 - hospEff);
    }

    const asymptCount = count * (1.0 - propSympt);
    const symptCount = count * propSympt;
    const hospCount = symptCount * propHosp;
    const nonHospCount = symptCount * (1.0 - propHosp);
    const severeCount = symptCount * propSevere;
    const mildHospCount = Math.max(0, hospCount - severeCount * 0.5);
    const severeHospCount = hospCount - mildHospCount;
    const deaths = hospCount * propDeath;

    incidence.bySeverity[0] += asymptCount;
    incidence.bySeverity[1] += Math.max(0, nonHospCount - severeCount * 0.5);
    incidence.bySeverity[2] += mildHospCount;
    incidence.bySeverity[3] += Math.max(0, severeCount * 0.5);
    incidence.bySeverity[4] += severeHospCount;
    incidence.bySeverity[5] += deaths;

    incidence.totalSymptomatic += symptCount;
    incidence.totalHospitalized += hospCount;
    incidence.totalSevere += severeCount;
    incidence.totalDeaths += deaths;

    const ageSev = incidence.byAgeAndSeverity[age];
    ageSev[0] += asymptCount;
    ageSev[1] += Math.max(0, nonHospCount - severeCount * 0.5);
    ageSev[2] += mildHospCount;
    ageSev[3] += Math.max(0, severeCount * 0.5);
    ageSev[4] += severeHospCount;
    ageSev[5] += deaths;
  }
}
