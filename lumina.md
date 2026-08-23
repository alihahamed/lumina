UNDER THE GUIDANCE:

Dr./Prof./ Faculty Name

Professor/Associate Professor /Assistant Professor,

Department of Computer Science & Engineering

YIT, Moodabidri. Mangaluru, D.K.

Ali Ahmed Syed      (4DM23IS002)

Derek Regan Henry (4DM23IS011)

Muhammed Aksam (4DM23IS019)

Stelvin Pinto            (4DM23IS054)

1

Deepak

**Lumina: An AI-Powered Real Time Scene Intelligence and Spacial Navigation System for the Visually Impaired**

**VISVESVARAYA TECHNOLOGICAL UNIVERSITY**

**Jnana Sangam, Belgaum -590014, Karnataka State, India**

**UNDER THE GUIDANCE:**

Prof. Rooha Razmid Ahamed

Department of Information Science & Engineering YIT, Moodabidri. Mangaluru, D.K.

**PRESENTED BY:**

**DEPARTMENT OF INFORMATION SCIENCE AND ENGINEERING**

**YENEPOYA INSTITUTE OF TECHNOLOGY**

**NH-13, Thodar, Moodbidri - 574 225, Mangaluru, D.K.**

**A  PROJECT ON**

## TABLE OF CONTENTS

2

- ABSTRACT
- INTRODUCTION
- PROBLEM STATEMENT
- OBJECTIVES
- LITERATURE SURVEY
- RESEARCH GAP
- EXISTING SYSTEMS
- PROPOSED SYSTEMS

- SYSTEM DESIGN
- ACTIVITY DIAGRAM (UML)
- SYSTEM REQUIREMENTS
- MODULE DESCRIPTION
- IMPLEMENTATION
- DB SCHEMA
- CONCLUSION

## ABSTRACT

Independent indoor navigation is a major challenge for the visually impaired due to GPS limitations. This project introduces Visionflow, a system combining Edge Computing and Vision Language Models (VLMs) for real-time assistance. It uses a dual-layer approach: a mobile-based layer (YOLO26) for instant obstacle detection and a cloud-based layer (LLaVA-OneVision) for deep scene understanding, like reading signs. A key innovation is the Semantic Spatial Memory module, which allows users to save personalized routes using vector embeddings and phone sensors—eliminating the need for expensive external beacons. Visionflow offers a scalable, low-cost framework to enhance navigational independence.

2

## INTRODUCTION

3

Lumina is a mobile-first assistive platform that acts as a "Digital Co-Pilot." It uses the smartphone camera to provide high-speed, real-time narration of the environment. Unlike standard object detectors, Lumina uses a Hybrid AI approach: local Edge AI for immediate obstacle avoidance and a Cloud-based Vision Language Model (VLM) for deep scene understanding. It features a unique Spatial Memory module, allowing users to "save" and "recall" specific indoor routes using voice commands and visual anchors.

## PROBLEM STATEMENT

3

Indoor navigation is a significant challenge for visually impaired individuals because conventional navigation technologies such as GPS provide poor localization and limited contextual information inside buildings. Indoor environments such as hospitals, universities, airports, shopping malls, and railway stations contain obstacles, signs, corridors, doors, stairs, and other semantic elements that cannot be adequately represented through conventional GPS-based navigation.

## OBJECTIVES

3

- The project uses **YOLO26** for the edge detection layer. YOLO26 is designed for real-time and edge deployment and supports end-to-end detection without requiring NMS in its default inference path.

- Use a Vision Language Model to provide higher-level understanding of an environment rather than simply identifying individual objects.

- Enable the system to recognize and interpret environmental information such as:

  - Room numbers
  - Directional signs
  - Exit signs

## LITERATURE  SURVEY

3

| **Name of the paper** | **Author’s Name** | **Published year** | **Advantages** | **Disadvantages** |
| --- | --- | --- | --- | --- |
| AI Guide Dog (AIGD): Egocentric Path Prediction on Smartphone | Jadhav, A., Zhang, J., et al. (AAAI Symposium) | 2025 | This system is a lightweight, vision-only solution that runs entirely on a smartphone, handling both goal-oriented and exploratory navigation without needing pre-mapped environments or GPS. | Because it relies on a multi-label classification approach for path prediction, it may struggle with highly complex or dynamic indoor layouts where visual landmarks are subtle or repetitive. |
| PISHYAR: A Socially Intelligent Smart Cane for Indoor Social Navigation | Joo, M. H., Taheri, A., et al. | 2026 | It integrates "socially compliant" navigation using a Raspberry Pi 5 and OAK-D camera, allowing the AI to understand social etiquette (like waiting in lines or recognizing group conversations). | The system requires specialized external hardware, making it significantly more expensive and less portable than a standard smartphone application. |
| VisionAI: Real-Time Object Detection Audio Assistant | Li, Y., Sachin, S., et al. | 2026 | It utilizes the same YOLOv10 model as our project, achieving an incredible processing speed of 4.2 ms per frame for 80 object classes, ensuring near-perfect real-time response. | It lacks a dedicated spatial memory or "route recall" module, meaning the user cannot save specific personalized paths and must rely entirely on active detection for every trip. |

## RESEARCH  GAP / EXISTING  LIMITATIONS

3

- Existing research has explored computer vision, sensor-based navigation, BLE beacons, and VLM-based assistance, but several limitations remain.

- **GPS is Ineffective Indoors**

  - GPS-based navigation works well in outdoor environments but becomes unreliable inside buildings because satellite signals are significantly degraded or unavailable.

- **Infrastructure Dependency**

Several indoor navigation systems rely on infrastructure such as:

- - BLE beacons
  - RFID
  - Wi-Fi positioning
  - Dedicated markers

- **Research gap:** There is a need for systems that can operate with minimal or no additional infrastructure.

## EXISTING SYSTEM

3

|  |  |  |
| --- | --- | --- |
| Existing Approach | Advantages | Limitations |
| GPS-based navigation | Widely available | Poor indoor accuracy |
| BLE Beacon systems | Good localization | Requires physical infrastructure |
| RFID-based systems | Reliable identification | Requires tags/readers |
| Computer Vision systems | Infrastructure-free | Can have computational limitations |
| Object Detection systems | Fast obstacle detection | Limited semantic understanding |
| VLM-based systems | Strong scene understanding | High latency/computational requirements |
| Static indoor maps | Useful for known buildings | Difficult to maintain and personalize |

## PROPOSED SYSTEM

3

Tiered Architecture

- Edge Layer (Local): Uses YOLOv10 for instant obstacle detection and haptic feedback with zero latency.
- Cloud Layer (Remote): Employs LLaVA-1.5-7B for deep scene understanding and reading complex signage.

Semantic Spatial Memory

- Infrastructure-Free: Navigates without Bluetooth beacons using the phone’s Compass and Accelerometer.
- Route Recall: Uses Vector Embeddings (pgvector) to "save" and "recall" personalized indoor paths.

Intelligent Interaction

- Multimodal Feedback: Combines Spatial Audio, TTS narration, and tactile pulses for intuitive guidance.
- Contextual Awareness: Describes social contexts and environmental layouts to reduce cognitive load.

## SYSTEM DESIGN

4

## ACTIVITY DIAGRAM (UML)

## SYSTEM REQUIREMENTS

Hardware (User Device)

- Processor: Modern Octa-core CPU (Snapdragon 8 Gen 2 or equivalent).
- Memory: Minimum 8GB RAM for real-time video processing.
- Sensors: Camera, Magnetometer (Compass), and Accelerometer/Gyroscope.
- Connectivity: 5G or High-speed Wi-Fi for cloud VLM inference.

Software & Backend

- Mobile OS: Android 12+ / iOS 16+ (supporting TFLite/CoreML).
- Cloud API: Serverless hosting for LLaVA-1.5-7B (VLM).
- Database: PostgreSQL + pgvector for spatial memory storage.
- Backend Framework: FastAPI for low-latency communication.
- Operational Needs
- Camera: 1080p resolution at 30fps for clear scene capture.
- Feedback: Functional Haptic Engine and Audio output (3.5mm or Bluetooth).

9

## MODULE  DESCRIPTION

**Module 1 — Camera and Sensor Acquisition**

- The smartphone acts as the primary sensing device.
- It collects:
- Camera frames
- Accelerometer data
- Gyroscope data
- Orientation information
- Other available smartphone sensor information

The camera provides visual information while the sensors provide motion and orientation information.

**Module 2 — Edge Object Detection**

- The captured camera stream is processed locally using **YOLO26**.
- Its primary responsibility is rapid detection of objects and obstacles.

9

**Module 3 — Cloud-Based Semantic Understanding**

- When deeper interpretation is required, selected frames are sent to the VLM layer. Your original architecture uses LLaVA-OneVision for this purpose.

- The model can interpret:

  - Signs
  - Room labels
  - Scene context
  - Environmental relationships
  - Text
  - Complex visual situations

LLaVA-OneVision was designed for single-image, multi-image, and video understanding.

**Module 4 — Semantic Spatial Memory**

- This is the key innovative component of Visionflow.
- Instead of simply remembering coordinates, the system stores semantic representations of places and routes.

**Module 5 — Sensor Fusion**

- Camera information alone may not be sufficient for reliable movement estimation.  Visionflow therefore combines visual information with smartphone sensor data.

- Conceptually:

  - Visual Observation + Accelerometer + Gyroscope + Orientation → Spatial Estimate

This improves the system's ability to understand how the user is moving through the environment.

9

## IMPLEMENTATION

9

Development Environment

Frontend

- React Native
- React Native Vision Camera

Programming Languages

- Python
- JavaScript / TypeScript

AI Models

- YOLO26
- LLaVA OneVision

## DB SCHEMA

## CONCLUSION

- Lumina proposes a low-cost, scalable, and intelligent indoor navigation framework for visually impaired individuals by combining edge computer vision, cloud-based vision-language reasoning, smartphone sensors, and semantic spatial memory.
- Unlike conventional GPS-based systems, Lumina is designed specifically for indoor environments where GPS is unreliable. Unlike infrastructure-dependent systems, the proposed framework aims to operate using commonly available smartphone hardware without requiring dedicated beacons or environmental modifications. Existing research demonstrates the feasibility of smartphone-based infrastructure-free computer-vision localization, supporting the underlying direction of the project.

## THANK YOU...