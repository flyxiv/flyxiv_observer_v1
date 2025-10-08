import argparse
import cv2
import numpy as np
import onnxruntime as ort

parser = argparse.ArgumentParser()
parser.add_argument("--onnx_model_path", type=str, required=True)
parser.add_argument("--image_path", type=str, required=True)
args = parser.parse_args()

# 1) Create session
session = ort.InferenceSession(args.onnx_model_path, providers=["CPUExecutionProvider"])
inp = session.get_inputs()[0]
input_name = inp.name          # e.g., "x"
# Expecting float32 NCHW for EfficientNet; check with: print(inp.shape, inp.type)

# 2) Load & preprocess image
size = 384  # EfficientNetV2-S
img = cv2.imread(args.image_path)                    # BGR uint8 HxWx3
img = cv2.resize(img, (size, size), interpolation=cv2.INTER_LINEAR)
img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

# HWC->CHW, scale to [0,1], normalize per channel
img = img.astype(np.float32) / 255.0
mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3,1,1)
std  = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3,1,1)
img = (img.transpose(2,0,1) - mean) / std           # (3,H,W)

# Add batch: (1,3,H,W)
input_tensor = np.expand_dims(img, axis=0).astype(np.float32)

# 3) Run
outputs = session.run(None, {input_name: input_tensor})
print("Output keys:", [o.name for o in session.get_outputs()])
for i, out in enumerate(outputs):
    print(f"out[{i}] shape:", out.shape)
    print(out)
