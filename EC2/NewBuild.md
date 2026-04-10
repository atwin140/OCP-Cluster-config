# EC2 New Build Pattern Working Document

## Document Control

**Document Title:** EC2 New Build Pattern
**Document Owner:** Infrastructure Team
**Version:** Draft 1.0
**Status:** Working Draft
**Last Updated:** April 10, 2026

---

## 1. Purpose

The purpose of this document is to define a standardized EC2 new build pattern to ensure that all new Amazon EC2 instances are deployed in a consistent, secure, supportable, and repeatable manner across approved environments.

This standard will help reduce configuration drift, improve deployment speed, support operational readiness, and align infrastructure builds with security and compliance requirements.

---

## 2. Objective

Establish a documented baseline for provisioning new EC2 instances, including required configuration standards, security controls, networking requirements, access methods, monitoring, and operational validation.

---

## 3. Scope

This document applies to all new EC2 instances built for supported environments, including but not limited to:

* Development
* Test
* Staging
* Production

This document covers:

* Instance build standards
* Operating system baseline requirements
* Storage and sizing considerations
* Network placement requirements
* Security controls
* Access and authentication standards
* Monitoring and logging requirements
* Validation and handoff requirements

This document does not cover:

* Legacy EC2 instances already in service
* Application-specific configuration beyond the server baseline
* Non-EC2 compute platforms unless explicitly approved

---

## 4. Business Need

A standardized EC2 build pattern is required to:

* Improve consistency across deployments
* Reduce manual build effort and errors
* Strengthen security posture through approved standards
* Simplify support and troubleshooting
* Improve audit readiness and compliance alignment
* Provide a repeatable foundation for automation

---

## 5. Roles and Responsibilities

### Infrastructure Team

* Define and maintain the EC2 build standard
* Provision instances according to approved patterns
* Validate baseline configuration
* Maintain supporting documentation

### Security Team

* Review and approve baseline security controls
* Validate compliance with approved standards
* Provide guidance on access, hardening, and logging requirements

### Application / Service Owners

* Provide workload-specific requirements
* Validate application readiness after build completion
* Confirm sizing and dependency requirements

### Operations Team

* Support monitoring, alerting, backup, and operational readiness
* Confirm handoff requirements are complete

---

## 6. Standard Build Requirements

### 6.1 Instance Configuration

Each new EC2 build must define and document the following:

* Instance name
* Environment
* Business owner
* Technical owner
* AWS account
* AWS region
* Instance type and size
* Operating system and version
* Availability zone requirements
* Backup requirements
* Patch group or maintenance group
* Required tags

### 6.2 Approved Tagging Standard

At a minimum, each EC2 instance must include approved tags for:

* Name
* Environment
* Application
* Owner
* Support Group
* Cost Center
* Backup Requirement
* Compliance Classification

### 6.3 Operating System Baseline

The EC2 build must use an approved and supported OS image. The baseline must include:

* Approved AMI source
* Current supported OS version
* Required security updates applied
* Standard package set
* Time synchronization configured
* Endpoint protection or required security agents installed
* Logging and monitoring agents installed as required

### 6.4 Storage Standard

Each EC2 build must define:

* Root volume size
* Additional data volumes if required
* Volume type
* Encryption requirements
* Snapshot and backup requirements
* Performance considerations based on workload needs

---

## 7. Networking Requirements

Each EC2 instance must be deployed in the correct network location and include the following documented requirements:

* VPC assignment
* Subnet selection
* Route table alignment
* Security group assignment
* Network ACL considerations if applicable
* Load balancer integration if required
* Static or dynamic addressing requirements
* DNS registration requirements

The selected network design must align with application communication needs, segmentation standards, and approved security architecture.

---

## 8. Security Requirements

All new EC2 builds must comply with approved security standards.

### Required controls include:

* IAM role assignment based on least privilege
* Approved security groups only
* Encrypted storage
* Restricted inbound access
* Approved outbound communication paths
* Endpoint protection deployment
* Centralized logging enabled
* Patch management alignment
* Vulnerability scanning alignment
* Administrative access restricted to approved methods

### Access Standards

Administrative access must follow approved enterprise methods, such as:

* Approved bastion or jump host process
* Systems Manager or other approved management channel
* Role-based access controls
* MFA-aligned administrative workflows where required

---

## 9. Monitoring and Logging Requirements

Each new EC2 build must include operational visibility requirements, including:

* Infrastructure monitoring enabled
* CPU, memory, disk, and network visibility
* Log forwarding to approved centralized logging platform
* Alerting thresholds defined as applicable
* Backup monitoring enabled
* Health validation after deployment

---

## 10. Build Process Overview

### Phase 1: Requirements Collection

* Confirm business purpose and workload need
* Gather sizing, storage, network, and access requirements
* Confirm environment and compliance requirements
* Identify application dependencies

### Phase 2: Build Design

* Select approved AMI
* Define instance type and storage layout
* Define networking placement
* Assign tags and ownership metadata
* Confirm security controls and access model

### Phase 3: Provisioning

* Deploy EC2 instance using approved pattern
* Apply tagging standard
* Attach IAM role
* Configure storage and encryption
* Apply security groups
* Join required management and monitoring services

### Phase 4: Validation

* Confirm instance is reachable through approved access path
* Confirm patch level and security tools are in place
* Confirm monitoring and logging are active
* Confirm DNS and naming requirements are complete
* Confirm backup and recovery settings are applied

### Phase 5: Handoff

* Document final configuration
* Confirm operational ownership
* Provide build record to stakeholders
* Transition to support and maintenance process

---

## 11. Deliverables

The following deliverables are expected for this effort:

* Approved EC2 new build pattern document
* Standard configuration checklist
* Tagging and naming standard reference
* Validation checklist
* Handoff template for completed builds
* Automation requirements for future implementation

---

## 12. Risks and Considerations

Potential risks include:

* Inconsistent implementation across teams
* Missing security controls during manual builds
* Insufficient tagging or ownership data
* Improper network placement
* Incomplete monitoring or backup configuration
* Variation between environments without formal approval

Mitigation should include peer review, validation checklists, approval gates, and eventual automation of the build pattern.

---

## 13. Success Criteria

This document and build pattern will be considered successful when:

* A standard EC2 build process is approved by stakeholders
* New EC2 instances are deployed using the documented baseline
* Security, networking, and monitoring controls are consistently applied
* Operational teams can support deployed instances without undocumented exceptions
* The pattern can be used as the basis for automation and scale-out deployment

---

## 14. Approval

| Role                | Name | Approval Status | Date |
| ------------------- | ---- | --------------- | ---- |
| Infrastructure Lead |      | Pending         |      |
| Security Lead       |      | Pending         |      |
| Operations Lead     |      | Pending         |      |
| Application Owner   |      | Pending         |      |

---

## 15. Appendix A – Draft Jira Story Reference

**Story Title:** Create a Standardized EC2 New Build Pattern

**Story Statement:**
As an infrastructure team, we need a standardized EC2 new build pattern so that new EC2 instances can be deployed consistently, securely, and efficiently across environments.

**Acceptance Summary:**

* Standard build pattern documented
* Required configuration standards defined
* Security requirements documented
* Networking requirements documented
* Monitoring and logging requirements documented
* Stakeholder review completed
* Pattern approved for future use
