#!/usr/bin/env python3
import sys
import numpy as np
import cv2
from insightface.app import FaceAnalysis


def cosine(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))


def main(img_path, emb_path):
    # Load stored embedding
    stored = np.fromfile(emb_path, dtype='float32')

    # Load image and convert to RGB
    img_bgr = cv2.imread(img_path)
    if img_bgr is None:
        print("Failed to read image.")
        sys.exit(1)
    img = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    # Initialize model (CPU-only)
    model = FaceAnalysis(
        name='buffalo_l',
        allowed_modules=['detection', 'recognition'],
        providers=['CPUExecutionProvider']
    )
    model.prepare(ctx_id=0)

    # Detect face
    faces = model.get(img)
    if not faces:
        print("No face detected.")
        sys.exit(1)

    # Compare embeddings
    score = cosine(faces[0].embedding, stored)
    print(f"Cosine similarity: {score:.4f}")

    if score < 0.35:
        print("Face mismatch.")
        sys.exit(1)

    print("Face verified.")
    sys.exit(0)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: verify_embedding.py <image.jpg> <embedding.bin>")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
