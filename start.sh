#!/bin/bash

echo "=== Current Directory ==="
pwd

echo "=== Listing files ==="
ls -l

echo "=== Looking inside /target ==="
ls -l target

echo "=== Trying to run the JAR ==="
java -jar target/example-java-1.0-SNAPSHOT-shaded.jar
