"""Metrics for FFXIV pull detector."""

import torch
from typing import Dict, Any
from pyffxivdata.dataset import ChoiceLabels

THRESHOLD = 0.5

def calculate_accuracy_for_each_label(
    y_pred_logits: torch.Tensor,  # (B,) or (B,1) logits for the positive class
    y_true: torch.Tensor,         # (B,) or (B,1) in {0,1}
    threshold: float = 0.5,       # probability threshold
) -> Dict[str, Any]:

    y_pred_logits = {
        "pull_start": y_pred_logits[:, 0],
        "pull_end": y_pred_logits[:, 1]
    }

    y_trues = {
        "pull_start": y_true[:, 0],
        "pull_end": y_true[:, 1]
    }

    accuracy_dict = {}

    for label, y_pred_logit in y_pred_logits.items():
        accuracy_dict[label] = {
            "true_positive": 0,
            "false_positive": 0,
            "true_negative": 0,
            "false_negative": 0
        }

        y_pred_logits = y_pred_logit.float().squeeze(-1)
        y_true = y_trues[label].squeeze(-1)

        # Convert ground truth to boolean
        if y_true.dtype.is_floating_point:
            y_true_bool = (y_true >= 0.5)
        else:
            y_true_bool = (y_true == 1)

        # Convert logits -> probs -> boolean preds
        probs = torch.sigmoid(y_pred_logits)
        y_pred_bool = (probs >= threshold)

        # Confusion counts
        tp = (y_pred_bool &  y_true_bool).sum().item()
        fp = (y_pred_bool & ~y_true_bool).sum().item()
        tn = (~y_pred_bool & ~y_true_bool).sum().item()
        fn = (~y_pred_bool &  y_true_bool).sum().item()

        accuracy_dict[label] = {
            "true_positive": tp,
            "false_positive": fp,
            "true_negative": tn,
            "false_negative": fn,
        }

    return accuracy_dict