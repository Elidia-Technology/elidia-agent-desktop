#!/bin/bash
set -e
echo "=== Building Elidia Agent Desktop for Linux ==="
cd "$(dirname "$0")"

# Clean
rm -rf linux-deb linux-appimage

# Build
docker build -t elidia-linux-pkg . -f- <<'DOCKERFILE'
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl build-essential pkg-config patchelf ca-certificates gnupg \
    libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
    librsvg2-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
    xdg-utils \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y nodejs \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /build
COPY . .
RUN npm install && (npx tauri build || true)
RUN mkdir -p /out && cp -r /build/src-tauri/target/release/bundle/deb /out/ 2>/dev/null; cp -r /build/src-tauri/target/release/bundle/appimage /out/ 2>/dev/null; cp -r /build/src-tauri/target/release/bundle/rpm /out/ 2>/dev/null; true
DOCKERFILE

# Extract artifacts
CID=$(docker create elidia-linux-pkg)
mkdir -p linux-deb linux-appimage linux-rpm
docker cp "$CID:/out/deb/." ./linux-deb/ 2>/dev/null || true
docker cp "$CID:/out/appimage/." ./linux-appimage/ 2>/dev/null || true
docker cp "$CID:/out/rpm/." ./linux-rpm/ 2>/dev/null || true
docker rm "$CID"

echo "=== Done ==="
ls -lh ./linux-deb/
ls -lh ./linux-appimage/
