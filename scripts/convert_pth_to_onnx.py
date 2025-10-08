import torch
import argparse

import torch.nn as nn
from torch.export import Dim

from pyffxivdata.model import FFXIVPullDetector  

def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--torch_checkpoint_path", type=str, required=True)
    parser.add_argument("--onnx_path", type=str, required=True)
    return parser.parse_args()

def convert_to_onnx(torch_checkpoint_path, onnx_path):
    model = FFXIVPullDetector(device="cpu")
    state = torch.load(torch_checkpoint_path, map_location="cpu")
    state = {k.replace("module.", ""): v for k,v in state.items()}
    model.load_state_dict(state, strict=True)
    model.eval()

    dummy = torch.randn(1, 3, 384, 384)

    exported = torch.onnx.export(model, dummy, dynamo=True)

    exported.save(onnx_path)
    print("Saved:", onnx_path)

if __name__ == "__main__":
    args = parse_args()
    convert_to_onnx(**vars(args))