import argparse
from pathlib import Path
import optuna
from pyffxivdata.train import split_train_val_image_ids,FFXIVPullDetectorTrainConfig,train,evaluate_val_metrics
from pyffxivdata.dataset import PullDetectorDataset
import logging
import mlflow
from optuna.integration.mlflow import MLflowCallback
import hydra
from omegaconf import OmegaConf
from torch.utils.data import DataLoader

@hydra.main(config_path="config")
def main(conf: OmegaConf):
    global config
    config = FFXIVPullDetectorTrainConfig(**conf)
    label_json_path = Path(config.dataset_base_dir) / "annotations.json"
    X_train, X_val = split_train_val_image_ids(label_json_path)

    image_dir = Path(config.dataset_base_dir) / "images"

    train_dataset = PullDetectorDataset(X_train, image_dir, True)
    val_dataset = PullDetectorDataset(X_val, image_dir, False)

    global train_dataloader
    global val_dataloader

    train_dataloader = DataLoader(train_dataset, batch_size=config.batch_size, shuffle=True)
    val_dataloader = DataLoader(val_dataset, batch_size=config.batch_size, shuffle=False)


    study = optuna.create_study(direction="maximize", storage="sqlite:///optuna.db")
    study.optimize(objective, n_trials=50)

    mlflow.set_tracking_uri("http://{config.mlflow_host}:{config.mlflow_port}")  # or leave default
    mlflow.set_experiment(f"{config.model_name}-tuning") 

    mlflc = MLflowCallback(
        tracking_uri=None,          
        metric_name="score",        
        create_experiment=True,     
    )

    with mlflow.start_run(run_name=f"{config.model_name}-tuning", nested=False):
        study = optuna.create_study(
            study_name=f"{config.model_name}-tuning", direction="minimize"
        )
        study.optimize(objective, n_trials=31, callbacks=[mlflc])


def objective(trial):
    batch_size = trial.suggest_categorical("batch_size", [1, 2, 4])
    lr = trial.suggest_float("lr", 1e-4, 1e-2)
    logging.info(f"Batch size: {batch_size}, LR: {lr}, Model: efficientnet")
    eta_min = trial.suggest_float("eta_min", 1e-6, 1e-4)
    experiment_config = config.copy()
    experiment_config.batch_size = batch_size
    experiment_config.lr = lr
    experiment_config.eta_min = eta_min
    experiment_config.num_epochs = 8
    model, _ , _ = train(experiment_config, train_dataloader, val_dataloader)
    logging.info("Training completed")

    return evaluate_val_metrics(model, val_dataloader, config.device)
   
    
if __name__ == "__main__":
    main()