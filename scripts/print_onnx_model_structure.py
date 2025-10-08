import onnx
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--onnx_model_path", type=str, required=True)
args = parser.parse_args()

m = onnx.load(args.onnx_model_path)
g = m.graph
print("Inputs:", [i.name for i in g.input])
for i, n in enumerate(g.node[:10]):  # show the first ~10 ops
    print(f"{i:02d}", n.op_type, "->", list(n.output), "<-", list(n.input))