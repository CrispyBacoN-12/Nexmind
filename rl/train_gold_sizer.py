"""
Offline PPO training for the gold desk's RL risk-adjusted sizer.

Trains against scripts/rl/build-gold-dataset.ts's output (a CSV of
proxyConfidence/atr/adx/bbWidth/exposurePct/cashPct/drawdownPct/side/reward
rows, one row per historical setup). Exports gold-sizer.onnx with feature
normalization baked into the graph, so rlSizer.ts never scales anything --
see the design doc's Component 3 for why (avoiding a Python/TypeScript
scaling side-channel that could silently drift out of sync).

Usage:
    pip install -r rl/requirements.txt
    python rl/train_gold_sizer.py --dataset rl/data/gold-dataset.csv --out rl/gold-sizer.onnx
"""
import argparse

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import gymnasium as gym
from gymnasium import spaces
from stable_baselines3 import PPO

FEATURES = ["proxyConfidence", "atr", "adx", "bbWidth", "exposurePct", "cashPct", "drawdownPct"]
ANNUAL_TRADING_DAYS = 252  # matches src/lib/trading/stats.ts's ANNUAL_TRADING_DAYS


def sharpe_like_reward(r_multiples: np.ndarray) -> float:
    """Matches stats.ts's sharpeRatio(): sqrt(252) * mean/std. Each row here is
    one trade's realized R-multiple scaled by the chosen weight, standing in
    for one day's P/L in the absence of a real daily equity curve."""
    if len(r_multiples) < 2:
        return 0.0
    std = r_multiples.std()
    if std <= 1e-12:
        return 0.0
    return float(np.sqrt(ANNUAL_TRADING_DAYS) * (r_multiples.mean() / std))


class GoldSizingEnv(gym.Env):
    """One episode = one full pass over the dataset in order. Action = target
    weight 0..1 of the allowed risk budget for that row's setup. Reward is
    given only at episode end (the Sharpe-like ratio over the whole episode's
    weighted R-multiples) so the policy is trained on risk-adjusted return,
    not a per-step P/L signal."""

    metadata = {"render_modes": []}

    def __init__(self, df: pd.DataFrame):
        super().__init__()
        self.df = df.reset_index(drop=True)
        self.observation_space = spaces.Box(low=-np.inf, high=np.inf, shape=(len(FEATURES),), dtype=np.float32)
        self.action_space = spaces.Box(low=0.0, high=1.0, shape=(1,), dtype=np.float32)
        self._i = 0
        self._weighted_r: list[float] = []

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self._i = 0
        self._weighted_r = []
        return self._obs(), {}

    def _obs(self) -> np.ndarray:
        row = self.df.iloc[self._i]
        return row[FEATURES].to_numpy(dtype=np.float32)

    def step(self, action):
        weight = float(np.clip(action[0], 0.0, 1.0))
        row = self.df.iloc[self._i]
        self._weighted_r.append(weight * float(row["reward"]))
        self._i += 1
        terminated = self._i >= len(self.df)
        reward = sharpe_like_reward(np.array(self._weighted_r)) if terminated else 0.0
        obs = self._obs() if not terminated else np.zeros(len(FEATURES), dtype=np.float32)
        return obs, reward, terminated, False, {}


class NormalizedPolicy(nn.Module):
    """Wraps the trained actor pipeline with a baked-in (x-mean)/std layer, so
    the exported ONNX graph accepts raw feature values -- see the design
    doc's Component 3 for why normalization is baked in rather than shipped
    as a side-channel scaler.json."""

    def __init__(self, actor: nn.Module, mean: np.ndarray, std: np.ndarray):
        super().__init__()
        self.actor = actor
        self.register_buffer("mean", torch.tensor(mean, dtype=torch.float32))
        self.register_buffer("std", torch.tensor(std, dtype=torch.float32))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        normalized = (x - self.mean) / self.std
        return self.actor(normalized)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--out", default="rl/gold-sizer.onnx")
    parser.add_argument("--timesteps", type=int, default=200_000)
    args = parser.parse_args()

    df = pd.read_csv(args.dataset)
    df = df.dropna(subset=FEATURES + ["reward"])
    print(f"Loaded {len(df)} training rows from {args.dataset}")

    mean = df[FEATURES].mean().to_numpy(dtype=np.float32)
    std = df[FEATURES].std().replace(0, 1).to_numpy(dtype=np.float32)

    env = GoldSizingEnv(df)
    model = PPO("MlpPolicy", env, verbose=1)
    model.learn(total_timesteps=args.timesteps)

    # mlp_extractor.policy_net turns the observation into a policy latent;
    # action_net turns that latent into the continuous action mean (SB3's
    # standard ActorCriticPolicy pipeline for a Box action space).
    actor = nn.Sequential(model.policy.mlp_extractor.policy_net, model.policy.action_net)
    wrapped = NormalizedPolicy(actor, mean, std)
    wrapped.eval()

    dummy_input = torch.zeros(1, len(FEATURES), dtype=torch.float32)
    torch.onnx.export(
        wrapped, dummy_input, args.out,
        input_names=["state"], output_names=["weight"],
        dynamic_axes={"state": {0: "batch"}, "weight": {0: "batch"}},
        opset_version=17,
    )
    print(f"Exported {args.out} (normalization baked in, feature order: {FEATURES})")


if __name__ == "__main__":
    main()
