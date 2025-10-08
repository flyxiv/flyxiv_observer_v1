
import os
import torch

from typing import Dict, Any, List
from PIL import Image
from torch.utils.data import Dataset
from torchvision import transforms as T
from torchvision.transforms import InterpolationMode
from pathlib import Path
from enum import Enum


affine = T.RandomAffine(
    degrees=12,
    translate=(0.05, 0.05),
    scale=(0.9, 1.1),
    shear=5,
    interpolation=InterpolationMode.BILINEAR,
    fill=128,          # avoid black corners
)

# We can add RandomCrop and ColorJitter later
TRAIN_TRANSFORM = T.Compose([
    T.RandomHorizontalFlip(p=0.5),
    affine,
    T.Resize((480, 480)),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], 
                       std=[0.229, 0.224, 0.225])
])

VALID_TRANSFORM = T.Compose([
    T.Resize((480, 480)),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], 
                       std=[0.229, 0.224, 0.225])
])

class ChoiceLabels(Enum):
    IsCombat = "IsCombat"
    HasRedCircle = "HasRedCircle"
    PullEnded = "PullEnded"

    def get_value(self) -> int:
        if self == ChoiceLabels.IsCombat:
            return 0
        elif self == ChoiceLabels.HasRedCircle:
            return 1
        else: 
            return 2

def to_torch_tensor(choices: List[str]) -> torch.Tensor:
    output = torch.zeros(3)

    for choice in choices:
        output[ChoiceLabels(choice).get_value()] = 1

    return output


class PullDetectorDataset(Dataset):
    def __init__(self, data_info, image_dir: str, is_train: bool) -> None:
        self.image_dir = image_dir
        self.data_info = data_info
        self.is_train = is_train

    def __len__(self) -> int:
        return len(self.data_info)
    
    def __getitem__(self, idx: int) -> Dict[str, Any]:
        """Output image and label tensor.
        
        image: (C, H, W)
        label: (3)
        """
        annotations = [] if not self.data_info[idx]['annotations'][0]['result'] else self.data_info[idx]['annotations'][0]['result'][0]['value']['choices']
        image_name = self.data_info[idx]['file_upload']
        image = Image.open(Path(self.image_dir) / f"{image_name}").convert("RGB")
        image = TRAIN_TRANSFORM(image) if self.is_train else VALID_TRANSFORM(image)
        label = to_torch_tensor(annotations)

        return {
            "image_name": image_name,
            "image": image,
            "label": label
        }