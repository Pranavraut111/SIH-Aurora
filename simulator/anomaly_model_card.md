# Anomaly model card — `anomaly_model_{maitri,bharati}.pkl` (v3)

Physics-residual anomaly detector for the Aurora digital twin. Replaces v2, which
flagged normal operation continuously (PROJECT_CONTEXT.md **B3**).

| Item | Value |
|---|---|
| Model | scikit-learn `IsolationForest` (300 trees, `max_samples=512`, `contamination="auto"`) **+ residual z-gate** |
| Decision | `is_anomaly = IF score ≥ threshold  OR  max |residual z| ≥ 6σ` (`triggeredBy` reports which rule fired) |
| Score | `anomaly_score` = original Isolation-Forest path score s(x) ∈ (0, 1]; ≈ 0.5 is the paper's boundary. **Not a probability.** |
| Threshold | 99.9th percentile of held-out normal scores + 0.02 (per station) |
| scikit-learn | **1.7.2** (pinned in `simulator/requirements.txt`; the pickles must be loaded with it) |
| Seed | `20260930` (`anomaly_engine.SEED`); training is bit-for-bit reproducible |
| Code | `simulator/anomaly_engine.py` (train/score), `simulator/evaluate_anomaly.py` (measure only) |

## What changed vs v2 (and why)

| v2 problem | v3 fix |
|---|---|
| Normal states recorded after **3 warm-up ticks** → gen_temp ≈ 44 °C in training vs ≈ 57 °C live → every live tick anomalous | Warm-up gate: ≥ 200 ticks **and** deterministic gen_temp drift `0.05·|target − gen_temp|` < 0.05 °C/tick for 20 consecutive ticks (the raw per-tick |Δgen_temp| test can't be met because the physics model adds N(0, 0.2 °C) noise every tick; p ≈ 1e-17). Observed warm-up: 200–599 ticks. |
| Trained on 120 s ticks, live runs 2 s ticks; "5-minute" rates assumed 120 s | Rates are **per physics tick** on **residuals** (see below); training runs the exact live tick path |
| Features included absolute weather/equipment values → novelty on unseen weather | Features are weather-independent residuals vs the physics prediction |
| Evidence "expected" = training-set mean (the 44 °C problem) | Evidence "expected" = **physics model prediction for the same tick** |
| heating_failure / co2_spike sensors were not in the feature set (undetectable) | Residuals cover generator, heating, living-quarters and water sensors |

**Rate units — why "per tick".** The physics model's state dynamics are per
`compute()` call (gen_temp moves 5 % of the way to its target per call, RPM 10 %),
independent of `dt` and of `AURORA_SPEED`. Rates per simulated minute would
therefore change with the replay speed (train/serve skew). Per-tick rates of the
*residuals* are invariant to speed, and weather (which does scale with speed)
cannot leak into them. Training, evaluation and live all call
`WeatherDataLayer.sample_at()` → `StationPhysicsModel.compute(dt=2 s)` →
`FeatureEngine.extract(observed, predicted)`, so units (wind in km/h) and
interpolation are identical by construction (tested).

## Features (15)

For each monitored sensor: `z = (observed − physics prediction, same tick) / σ`.

| Sensor | Building | Assumed sensor noise σ |
|---|---|---|
| gen_temp | generator | 0.5 °C |
| gen_rpm | generator | 5 rpm |
| gen_power | generator | 1.5 kW |
| gen_fuel_rate | generator | 0.3 L/hr |
| heat_a_temp | heating | 0.5 °C |
| heat_a_flow | heating | 0.3 L/min |
| lq_temp | livingQuarters | 0.2 °C |
| lq_co2 | livingQuarters | 15 ppm |
| lq_humidity | livingQuarters | 1 % |
| water_level | waterTank | 0.5 % |

Plus rates of the residual z per tick: `gen_temp`, `gen_rpm`, `gen_fuel_rate`,
`heat_a_temp` over 3 ticks, and `gen_temp` over 10 ticks.
**σ values are assumptions** (no real sensor noise data); training observations
are `prediction + N(0, σ)`.

### Training data

| Station | ERA5 window start | Warm-up ticks (discarded) | Normal samples |
|---|---|---:|---:|
| maitri | 2024-01-14 | 202 | 2663 |
| maitri | 2024-07-15 | 599 | 2266 |
| maitri | 2024-09-15 | 349 | 2516 |
| maitri | 2025-10-14 | 394 | 2471 |
| maitri | 2026-08-30 | 317 | 2548 |
| maitri | 2026-08-31 | 329 | 2536 |
| bharati | 2024-01-14 | 200 | 2665 |
| bharati | 2024-07-15 | 307 | 2558 |
| bharati | 2024-09-15 | 217 | 2648 |
| bharati | 2025-10-14 | 248 | 2617 |
| bharati | 2026-08-30 | 234 | 2631 |
| bharati | 2026-08-31 | 208 | 2657 |

- **maitri**: 12000 training + 3000 calibration samples; threshold = 0.5537; trained 2026-10-01T02:21:32Z
- **bharati**: 12621 training + 3155 calibration samples; threshold = 0.5644; trained 2026-10-01T02:21:32Z

### False-positive rate (un-injected replay, full converged window)

| Station | Date | Ticks | Simulated minutes | FPR (live-exact) | FPR (with assumed sensor noise) |
|---|---|---:|---:|---:|---:|
| maitri | 2024-01-14 | 2629 | 10516 | 0.00% | 0.15% |
| maitri | 2024-07-15 | 2059 | 8236 | 0.00% | 0.05% |
| maitri | 2024-09-15 | 2498 | 9992 | 0.00% | 0.00% |
| maitri | 2025-10-14 | 2626 | 10504 | 0.00% | 0.08% |
| maitri | 2026-08-30 | 2535 | 10140 | 0.00% | 0.04% |
| maitri | 2026-08-31 | 2626 | 10504 | 0.00% | 0.04% |
| bharati | 2024-01-14 | 2666 | 10664 | 0.00% | 0.04% |
| bharati | 2024-07-15 | 2654 | 10616 | 0.00% | 0.15% |
| bharati | 2024-09-15 | 2498 | 9992 | 0.00% | 0.00% |
| bharati | 2025-10-14 | 2603 | 10412 | 0.00% | 0.00% |
| bharati | 2026-08-30 | 2596 | 10384 | 0.00% | 0.04% |
| bharati | 2026-08-31 | 2651 | 10604 | 0.00% | 0.04% |

### Synthetic degradations (60 runs each, ramp over 30 ticks, sensor noise on)

| Station | Scenario | Detection | Time-to-detect median / p90 (ticks) | Median (real s) | Median (simulated min @120×) |
|---|---|---:|---:|---:|---:|
| maitri | cooling_degradation | 60/60 (100%) | 4 / 7 | 9 | 18 |
| maitri | fuel_system_degradation | 60/60 (100%) | 12 / 18 | 25 | 50 |
| maitri | heating_degradation | 60/60 (100%) | 5 / 6 | 10 | 20 |
| maitri | bearing_wear | 60/60 (100%) | 2 / 4 | 4 | 8 |
| bharati | cooling_degradation | 60/60 (100%) | 6 / 10 | 12 | 24 |
| bharati | fuel_system_degradation | 60/60 (100%) | 12 / 17 | 24 | 48 |
| bharati | heating_degradation | 60/60 (100%) | 5 / 7 | 10 | 20 |
| bharati | bearing_wear | 60/60 (100%) | 2 / 4 | 4 | 8 |

### Demo Control scenarios (30 runs each, injected exactly like simulator.py)

| Station | Scenario | Detection | Time-to-detect median / p90 (ticks) | Median (real s) | Median (simulated min @120×) |
|---|---|---:|---:|---:|---:|
| maitri | generator_failure | 30/30 (100%) | 1 / 1 | 2 | 4 |
| maitri | heating_failure | 30/30 (100%) | 1 / 1 | 2 | 4 |
| maitri | co2_spike | 30/30 (100%) | 1 / 1 | 2 | 4 |
| bharati | generator_failure | 30/30 (100%) | 1 / 1 | 2 | 4 |
| bharati | heating_failure | 30/30 (100%) | 1 / 1 | 2 | 4 |
| bharati | co2_spike | 30/30 (100%) | 1 / 1 | 2 | 4 |

Acceptance criteria (FPR < 2 % for every station/date; detection ≥ 90 % for every
type/scenario): **all met**. 1 tick = 2 s real = 4 simulated minutes at 120×.
Synthetic degradations: severity ramps 0 → U(0.15, 0.45) over 30 ticks
(cooling: gen_temp ×(1+s); fuel: fuel ×(1+s), power ×(1−0.3s); heating: Zone-A
supply temp and flow ×(1−s); bearing wear: RPM ×(1−s) + noise, gen_temp ×(1+0.5s)).

## Known limitations

- **Simulated ground truth.** In the running demo, "observed" values *are* the
  physics model's output, so un-injected residuals are exactly zero and the live
  FPR (0.00 %) is true by construction. The "with assumed sensor noise" column is
  the more meaningful estimate — and it depends on the **assumed** σ values.
  Real-sensor FPR is unknown until real station data exists.
- **Synthetic degradations only.** Detection numbers are against prototype
  signatures defined in `anomaly_engine.DEGRADATIONS`, not real failure data.
- **Same weather for training and evaluation.** Evaluation uses different
  physics-noise seeds but the same 6 cached ERA5 windows (no held-out dates);
  the features are weather-independent residuals, which limits — but does not
  eliminate — this concern. The 2026-08-30 and 2026-08-31 windows overlap by 7 days.
- **Isolation Forest saturates** beyond the training range, so large single-sensor
  deviations rely on the 6σ residual gate; the IF mainly adds sensitivity to
  combined/subtle deviations and rates.
- **Candidate causes are rule-based** (`AnomalyDetector.CAUSE_SIGNATURES`) and
  reported as *possible* causes; they are not a trained classifier.
- Physics-model fidelity limits everything: residuals are only as good as the
  digital twin's prediction.

## How to retrain

```bash
# from the repo root, with the runtime venv (scikit-learn==1.7.2)
python simulator/anomaly_engine.py --dry-run          # train + evaluate, never writes models
python simulator/anomaly_engine.py                    # writes the .pkl files ONLY if all criteria pass
python simulator/evaluate_anomaly.py                  # re-measure the saved models (never writes)
pytest simulator/tests/test_anomaly_model.py          # load / FP / detection / train-serve-skew tests
```

Training uses every ERA5 window in `simulator/weather_cache/` for each station
(add a cached window → it is included automatically). Update this card's tables
from `evaluate_anomaly.py --json` output after retraining.
