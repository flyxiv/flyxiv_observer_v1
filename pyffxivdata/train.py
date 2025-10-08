import os
import torch
import yaml
import argparse
import json
import logging
import pandas as pd
import mlflow
import hydra
import torch.nn as nn

from omegaconf import OmegaConf
from tqdm import tqdm
from pathlib import Path
from typing import List, Tuple
from pydantic import BaseModel
from torch.utils.data import DataLoader
from sklearn.model_selection import train_test_split
from pyffxivdata.dataset import PullDetectorDataset
from pyffxivdata.model import FFXIVPullDetector
from pyffxivdata.loss import ff_pull_detector_loss
from pyffxivdata.metric import calculate_accuracy_for_each_label
from mlflow.models import infer_signature


class FFXIVPullDetectorTrainConfig(BaseModel):
    lr: float
    batch_size: int
    num_epochs: int
    eta_min: float

    device: str = "cuda" if torch.cuda.is_available() else "cpu"
    save_dir: str | None = None
    model_name: str
    dataset_base_dir: str
    mlflow_host: str
    mlflow_port: int

    @staticmethod
    def load_from_config_yaml(config_dir: str) -> "FFXIVPullDetectorTrainConfig":
        with open(config_dir, "r") as f:
            config = yaml.safe_load(f)

        return FFXIVPullDetectorTrainConfig(**config)

class MLFlowLogParam(BaseModel):
    lr: float
    batch_size: int
    num_epochs: int
    eta_min: float
    model_name: str

        

def evaluate_val_metrics(model: FFXIVPullDetector, val_dataloader: DataLoader, device: str, accuracy_dict=None, metrics_history=None, label_idx: int = 1):
    for batch in tqdm(val_dataloader, desc="Evaluating", total=len(val_dataloader)):
        image_batch = batch["image"].to(device)
        label_batch = batch["label"].to(device)

        with torch.no_grad():
            choice_logits = model(image_batch)
            accuracy_batch = calculate_accuracy_for_each_label(choice_logits, label_batch[:, label_idx])

            if accuracy_dict is None:
                accuracy_dict = {}

            for label, value in accuracy_batch.items():
                if label not in accuracy_dict:
                    accuracy_dict[label] = {
                        "true_positive": 0,
                        "false_positive": 0,
                        "true_negative": 0,
                        "false_negative": 0
                    }

                accuracy_dict[label]["false_positive"] += value["false_positive"]
                accuracy_dict[label]["false_negative"] += value["false_negative"]
                accuracy_dict[label]["true_positive"] += value["true_positive"]
                accuracy_dict[label]["true_negative"] += value["true_negative"]
                
    score = 0

    if metrics_history is None:
        metrics_history = {}

    for label, value in accuracy_dict.items():
        accuracy = (value['true_positive'] + value['true_negative']) / (value['true_positive'] + value['false_positive'] + value['true_negative'] + value['false_negative'])
        precision = value['true_positive'] / (value['true_positive'] + value['false_positive']) if (value['true_positive'] + value['false_positive']) > 0 else 0
        recall = value['true_positive'] / (value['true_positive'] + value['false_negative']) if (value['true_positive'] + value['false_negative']) > 0 else 0
        print(f"{label} Accuracy: {accuracy}")
        print(f"{label} Precision: {precision}")
        print(f"{label} Recall: {recall}")

        if f"{label}_accuracy" not in metrics_history:
            metrics_history[f"{label}_accuracy"] = []
            metrics_history[f"{label}_precision"] = []
            metrics_history[f"{label}_recall"] = []
        
        score += (accuracy + precision + recall)
        metrics_history[f"{label}_accuracy"].append(accuracy)
        metrics_history[f"{label}_precision"].append(precision)
        metrics_history[f"{label}_recall"].append(recall)

    return score


def train(config: FFXIVPullDetectorTrainConfig, train_dataloader: DataLoader, val_dataloader: DataLoader) -> None:
    model = FFXIVPullDetector(config.device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=config.lr)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=config.num_epochs, eta_min=config.eta_min)

    logging.info(f"Training config: {config.model_dump_json()}")
    logging.info(f"Training started with {config.num_epochs} epochs")

    step_cnt = 0
    running_loss = 0.0

    model.train()
    optimizer.zero_grad(set_to_none=True)

    stop_training = False
    best_score = 0
    metrics_history = {
        "step": [],
        "loss": [],
    }
    best_metrics_history = None
    os.makedirs(config.save_dir, exist_ok=True)

    if config.model_name == "pull_start_detector":
        label_idx = 1
    elif config.model_name == "pull_end_detector":
        label_idx = 2
    elif config.model_name == "pull_detector":
        label_idx = [1, 2]
    else:
        raise ValueError(f"Invalid model name: {config.model_name}")
    print(f"Label index: {label_idx}")

    for epoch in range(config.num_epochs):
        logging.info(f"Epoch {epoch}:")
        for batch in tqdm(train_dataloader, desc="Training", total=len(train_dataloader)):
            image_batch = batch["image"].to(config.device)
            label_batch = batch["label"].to(config.device).float()
            label_batch = label_batch[:, label_idx]

            choice_logits = model(image_batch).squeeze(1)

            loss = nn.BCEWithLogitsLoss()(
                choice_logits, label_batch
            )

            loss.backward()

            running_loss += float(loss.item())

            step_cnt += 1

            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad(set_to_none=True)

            avg_loss = running_loss 
            print(f"Step {step_cnt} | AvgLoss: {avg_loss:.4f}")
            running_loss = 0.0

        model.eval()
        accuracy_dict = {}
        score = evaluate_val_metrics(model, val_dataloader, config.device, accuracy_dict, metrics_history, label_idx)

        model.train()

        metrics_history['step'].append(step_cnt)
        metrics_history['loss'].append(avg_loss)

        print(score)
        print(f"best_score: {best_score}")
        if config.save_dir and score > best_score:
            best_score = score
            best_metrics_history = {k: v[-1] for k, v in metrics_history.items()} 
            pd.DataFrame(metrics_history).to_csv(Path(config.save_dir) / "metrics_history.csv", index=False)
            torch.save(model.state_dict(), Path(config.save_dir) / f"best_model.pth")
            print(f"saved at: {Path(config.save_dir) / f'best_model.pth'}")

    if config.save_dir:
        pd.DataFrame(metrics_history).to_csv(Path(config.save_dir) / "metrics_history.csv", index=False)
        torch.save(model.state_dict(), Path(config.save_dir) / "last_epoch.pth")    

    return model, best_metrics_history, best_score


def split_train_val_image_ids(label_json_path: str) -> Tuple[List[int], List[int]]:
    with open(label_json_path, "r") as f:
        X = json.load(f)
    
    return train_test_split(X, test_size=0.1, random_state=42)

@hydra.main(config_path="config")
def main(config: OmegaConf):
    config = FFXIVPullDetectorTrainConfig(**config)
    label_json_path = Path(config.dataset_base_dir) / "annotations.json"
    X_train, X_val = split_train_val_image_ids(label_json_path)

    image_dir = Path(config.dataset_base_dir) / "images"

    train_dataset = PullDetectorDataset(X_train, image_dir, True)
    val_dataset = PullDetectorDataset(X_val, image_dir, False)
    train_dataloader = DataLoader(train_dataset, batch_size=config.batch_size, shuffle=True)
    val_dataloader = DataLoader(val_dataset, batch_size=config.batch_size, shuffle=False)

    model, final_metrics, _ = train(config, train_dataloader, val_dataloader)
    mlflow.set_tracking_uri(uri=f"http://{config.mlflow_host}:{config.mlflow_port}")
    mlflow.set_experiment("FFXIV Pull Detector Experiment")
    
    with mlflow.start_run():
        mlflow_params = MLFlowLogParam(**config.model_dump())
        mlflow.log_params(mlflow_params.model_dump())

        for metric_name, metric_value in final_metrics.items():
            if metric_name == "step" or metric_name == "loss":
                continue
            print(f"{metric_name}: {metric_value}")
            mlflow.log_metric(metric_name, metric_value)

        input_sample = next(iter(train_dataloader))["image"].to(config.device)
        signature = infer_signature(input_sample, model(input_sample))

        model_info = mlflow.pytorch.log_model(
            pytorch_model=model,
            name=config.model_name,
            signature=signature,
            input_example=X_train,
            registered_model_name=config.model_name,
        )

        mlflow.set_logged_model_tags(
            model_info.model_id, {"Training Info": "FFXIV Pull Detector by small EfficientNet."}
        )


if __name__ == "__main__":
    main()
