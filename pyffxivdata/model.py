"""CV model for classifying clothes into different categories.

Current category: https://github.com/Sera-Virtual-Closet/sera-ai/issues/2#issue-3287064819

run ex) in sera-ai base directory,

```sh
python -m pyseraai.clothing_classification.train --config_dir train_config.yml --dataset_base_dir ./resources/fashion-dataset
```
"""
import torch
import torch.nn as nn
from collections import OrderedDict
from typing import Tuple
from torchvision.models import efficientnet_v2_m, EfficientNet_V2_M_Weights
from pyffxivdata.dataset import ChoiceLabels

class FFXIVPullDetector(nn.Module):
    """Transfer Learning model for classifying clothes into different categories.

    Uses ImageNet pretrained model as a backbone and attaches a classifier head.

    Category can have only one value out of the possible options, and the other labels can all have multiple labels, so their heads are splitted. 
    """

    def __init__(self, device: str) -> None:
        super().__init__()

        self.device = device

        self.model = efficientnet_v2_m(weights=EfficientNet_V2_M_Weights.IMAGENET1K_V1)
        self.in_features = self.model.classifier[-1].in_features
        self.model.classifier = nn.Identity()
        self.mlp = nn.Sequential(
            OrderedDict(
                [
                    # ("fc1", nn.Linear(self.in_features, self.in_features)),
                    # ("gelu1", nn.GELU()),
                    # ("fc2", nn.Linear(self.in_features, self.in_features // 2)),
                    # ("gelu2", nn.GELU()),
                    # ("fc3", nn.Linear(self.in_features // 2, self.in_features // 2)),
                    # ("gelu3", nn.GELU()),
                    # ("fc4", nn.Linear(self.in_features // 2, self.in_features // 4)),
                    # ("gelu4", nn.GELU()),
                    # ("fc5", nn.Linear(self.in_features // 4, 1)),
                    ('output', nn.Linear(self.in_features, 2)),
                ]
            )
        )

        self.to(device)


    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Forward pass of the model.

        Args:
            x: (B, C, H, W)

        Returns:
        """
        return self.mlp(self.model(x))