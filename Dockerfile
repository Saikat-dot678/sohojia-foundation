# Use slim Python image as base
FROM python:3.10-slim

# Set working directory inside container
WORKDIR /app

# Install Node.js 18.x and build tools
RUN apt-get update && \
    apt-get install -y curl gnupg build-essential && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean

# Copy only scripts for early layer caching and install Python deps
COPY scripts/ ./scripts/

# Install Python dependencies for face recognition
RUN pip install --upgrade pip && \
    pip install insightface onnxruntime opencv-python-headless numpy

# Copy Node.js dependency files and install packages
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of your app (excluding what's in .dockerignore)
COPY . .

# Expose your backend's port (e.g., Express.js uses 5000)
EXPOSE 3000

# Run the main Node.js app
CMD ["node", "app.js"]
