FROM python:3.12.4

WORKDIR /app


# Dependencies
RUN  apt-get update && \
     apt-get -y install nano procps && \
     rm -rf /var/lib/apt/lists/*


# Setup Backend
RUN pip install --no-cache-dir     \
     "requests==2.32.3"            \
     "flask==3.0.3"


# Copy the source code
COPY . .

EXPOSE 8000
CMD ["python3", "-u", "main.py"]
