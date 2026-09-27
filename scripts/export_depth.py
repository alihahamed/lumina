"""Export Depth Anything V2 Metric-Indoor-Small to an ExecuTorch .pte (XNNPACK, fp32).

Contract (matches SemanticSegmentationModule.fromCustomModel):
  input  float32 [1,3,S,S]  RGB in [0,1] then (x-mean)/std applied by the runtime
  output float32 [1,1,S,S]  depth in metres (single channel is passed through raw)
"""
import sys
import torch
from transformers import AutoModelForDepthEstimation
from executorch.backends.xnnpack.partition.xnnpack_partitioner import XnnpackPartitioner
from executorch.exir import to_edge_transform_and_lower

SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 252  # must be a multiple of 14
OUT = sys.argv[2] if len(sys.argv) > 2 else f"depth_anything_v2_metric_indoor_s_{SIZE}.pte"
REPO = "depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf"


class DepthWrapper(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        d = self.m(pixel_values=x).predicted_depth  # [1,H,W]
        return d.unsqueeze(1)  # [1,1,H,W]


model = DepthWrapper(AutoModelForDepthEstimation.from_pretrained(REPO)).eval()
example = (torch.rand(1, 3, SIZE, SIZE),)
with torch.no_grad():
    ref = model(*example)
print("eager output", tuple(ref.shape), float(ref.min()), float(ref.max()))

ep = torch.export.export(model, example, strict=False)
prog = to_edge_transform_and_lower(ep, partitioner=[XnnpackPartitioner()]).to_executorch()
with open(OUT, "wb") as f:
    f.write(prog.buffer)
print("wrote", OUT, len(prog.buffer) / 1e6, "MB")
