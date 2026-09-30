# Aurora Forecast Arena — Evaluation Report

**Generated**: 2026-09-29 21:25 UTC

**Models evaluated**:
1. **Exponential Smoothing** (Holt's linear trend, α=0.3, β=0.1)
2. **Physics Forward Forecast** (digital twin + ERA5 weather + forecast uncertainty)
3. **Chronos-Bolt-Small** (amazon/chronos-bolt-small, 48M params, zero-shot)

> **Note**: Ground truth is physics-model-derived telemetry driven by ERA5 reanalysis weather.
> These results measure forecasting accuracy on simulated data, not real sensor measurements.


## Station: MAITRI


### Signal: `gen_temp_C`

| Horizon | Baseline MAE | Physics MAE | Chronos MAE | Baseline RMSE | Physics RMSE | Chronos RMSE | Chronos Coverage |
|---------|-------------|-------------|-------------|---------------|--------------|--------------|-----------------|
|   +1h |        1.72 |        0.69 |        0.46 |          2.07 |         0.85 |         0.58 |             78% |
|   +6h |        9.31 |        1.12 |           — |         11.18 |         1.39 |            — |               — |
|  +12h |       19.15 |        1.86 |           — |         22.88 |         2.40 |            — |               — |
|  +24h |       37.69 |        3.26 |           — |         45.42 |         4.11 |            — |               — |

*Evaluation points: 49 | Chronos forecasts: 49*


### Signal: `gen_load_pct`

| Horizon | Baseline MAE | Physics MAE | Chronos MAE | Baseline RMSE | Physics RMSE | Chronos RMSE | Chronos Coverage |
|---------|-------------|-------------|-------------|---------------|--------------|--------------|-----------------|
|   +1h |        0.93 |        0.93 |        0.45 |          1.20 |         1.15 |         0.56 |             80% |
|   +6h |        5.29 |        1.47 |           — |          6.84 |         1.83 |            — |               — |
|  +12h |       10.86 |        2.76 |           — |         13.75 |         3.31 |            — |               — |
|  +24h |       23.87 |        4.23 |           — |         29.75 |         5.03 |            — |               — |

*Evaluation points: 49 | Chronos forecasts: 49*


### Signal: `fuel_rate_Lhr`

| Horizon | Baseline MAE | Physics MAE | Chronos MAE | Baseline RMSE | Physics RMSE | Chronos RMSE | Chronos Coverage |
|---------|-------------|-------------|-------------|---------------|--------------|--------------|-----------------|
|   +1h |        0.30 |        0.24 |        0.15 |          0.39 |         0.30 |         0.19 |             78% |
|   +6h |        1.67 |        0.47 |           — |          2.24 |         0.56 |            — |               — |
|  +12h |        3.43 |        0.62 |           — |          4.50 |         0.80 |            — |               — |
|  +24h |        7.72 |        1.17 |           — |          9.99 |         1.41 |            — |               — |

*Evaluation points: 49 | Chronos forecasts: 49*


## Station: BHARATI


### Signal: `gen_temp_C`

| Horizon | Baseline MAE | Physics MAE | Chronos MAE | Baseline RMSE | Physics RMSE | Chronos RMSE | Chronos Coverage |
|---------|-------------|-------------|-------------|---------------|--------------|--------------|-----------------|
|   +1h |        1.15 |        0.62 |        0.45 |          1.38 |         0.78 |         0.59 |             84% |
|   +6h |        6.45 |        1.20 |           — |          7.67 |         1.49 |            — |               — |
|  +12h |       12.16 |        1.77 |           — |         14.42 |         2.37 |            — |               — |
|  +24h |       25.82 |        3.74 |           — |         30.61 |         4.47 |            — |               — |

*Evaluation points: 49 | Chronos forecasts: 49*


### Signal: `gen_load_pct`

| Horizon | Baseline MAE | Physics MAE | Chronos MAE | Baseline RMSE | Physics RMSE | Chronos RMSE | Chronos Coverage |
|---------|-------------|-------------|-------------|---------------|--------------|--------------|-----------------|
|   +1h |        0.62 |        0.63 |        0.27 |          0.75 |         0.79 |         0.34 |             86% |
|   +6h |        3.32 |        1.79 |           — |          4.12 |         2.24 |            — |               — |
|  +12h |        6.34 |        2.18 |           — |          7.94 |         2.92 |            — |               — |
|  +24h |       13.49 |        3.66 |           — |         17.26 |         4.45 |            — |               — |

*Evaluation points: 49 | Chronos forecasts: 49*


### Signal: `fuel_rate_Lhr`

| Horizon | Baseline MAE | Physics MAE | Chronos MAE | Baseline RMSE | Physics RMSE | Chronos RMSE | Chronos Coverage |
|---------|-------------|-------------|-------------|---------------|--------------|--------------|-----------------|
|   +1h |        0.22 |        0.24 |        0.09 |          0.27 |         0.30 |         0.11 |             84% |
|   +6h |        1.28 |        0.55 |           — |          1.56 |         0.65 |            — |               — |
|  +12h |        2.41 |        0.58 |           — |          2.92 |         0.70 |            — |               — |
|  +24h |        4.96 |        0.99 |           — |          5.97 |         1.26 |            — |               — |

*Evaluation points: 49 | Chronos forecasts: 49*


## Methodology

- **Walk-forward**: At each evaluation point, models predict future values using only past data
- **Ground truth**: Physics model output driven by cached ERA5 reanalysis weather
- **Warmup**: 120 minutes before evaluation starts
- **Evaluation interval**: Every 60 minutes
- **Chronos context**: Up to 512 downsampled 1-minute observations
- **Physics forecast**: Cloned physics model run forward with weather perturbation (±1-4°C)
- **Baseline**: Holt's linear trend method (α=0.3, β=0.1) extrapolated forward

## Limitations

- Ground truth is model-derived, not real sensor data
- Physics forecast has structural advantage (same model generates ground truth)
- Weather uncertainty is simulated, not from actual forecast errors
- Chronos operates zero-shot with no Aurora-specific fine-tuning
- Evaluation period covers a single weather sequence, not seasonal variation
- Chronos maximum native prediction length may limit longer horizons
