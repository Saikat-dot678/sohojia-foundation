#!/usr/bin/env python3
import sys
import os
import numpy as np
import cv2
from insightface.app import FaceAnalysis


def main(input_dir, out_path):
    # Initialize FaceAnalysis with detection and recognition modules
    model = FaceAnalysis(name='buffalo_l', allowed_modules=['detection', 'recognition'])
    # Prepare model for CPU inference
    model.prepare(ctx_id=0)

    descriptors = []
    # Iterate over images in sorted order
    for fname in sorted(os.listdir(input_dir)):
        if not fname.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        img_path = os.path.join(input_dir, fname)
        # Read image using OpenCV and convert to RGB
        img_bgr = cv2.imread(img_path)
        if img_bgr is None:
            continue
        img = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

        # Detect faces and extract embeddings
        faces = model.get(img)
        if not faces:
            continue
        embedding = faces[0].embedding
        descriptors.append(embedding)

    # Exit with error if no faces were detected
    if not descriptors:
        print('No faces detected; aborting.')
        sys.exit(1)

    # Average the embeddings
    emb = np.mean(np.stack(descriptors, axis=0), axis=0).astype('float32')
    # Save embedding to binary file
    emb.tofile(out_path)
    sys.exit(0)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Usage: generate_embedding.py <input_dir> <out_bin>')
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
