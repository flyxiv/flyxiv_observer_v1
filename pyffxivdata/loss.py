import torch
import torch.nn as nn

def ff_pull_detector_loss(y_pred_logits: torch.Tensor, y_true: torch.Tensor) -> torch.Tensor:
    """Loss function for FFXIV pull detector.

    Uses binary cross entropy for each element of the other labels.

    Args:
        y_pred_logits: (B, 2)
        y_true: (B)

    Returns:
        loss: torch.Tensor
    """
    y_true = y_true.unsqueeze(1)

    assert y_true.dim() == 2, f"y_true must be of shape (B, 2), but it is shape: {y_true.shape}" 
    assert y_pred_logits.shape == y_true.shape, f"y_pred_logits and y_true must be of shape (B, 1), but y_pred_logits is shape: {y_pred_logits.shape} and y_true is shape: {y_true.shape}"

    return nn.BCEWithLogitsLoss()(y_pred_logits, y_true) 