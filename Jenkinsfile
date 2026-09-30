pipeline {
  agent { label 'docker-vps' }

  options {
    timestamps()
    disableConcurrentBuilds(abortPrevious: true)
    timeout(time: 30, unit: 'MINUTES')
    skipDefaultCheckout(true)
  }

  environment {
    COMPOSE_FILE = '.ci/jenkins-compose.yml'
    // Build numbers are job-local; the executor number also separates concurrent
    // multibranch jobs sharing the same Docker host.
    COMPOSE_PROJECT_NAME = "pipex-ci-${EXECUTOR_NUMBER}-${BUILD_NUMBER}"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Environment') {
      steps {
        script {
          if (env.CHANGE_FORK?.trim()) {
            error('Fork pull requests do not run on the Docker-capable PipeX agent.')
          }
        }
        sh '''
          set -eu
          printf 'Git commit: %s\\n' "$(git rev-parse HEAD)"
          printf 'Branch: %s\\n' "${BRANCH_NAME:-$(git branch --show-current)}"
        '''
      }
    }

    stage('CI gates') {
      parallel {
        failFast true

        stage('Quality / Node 20.19') {
          steps {
            sh 'bash .ci/run-jenkins-job.sh node20-ci quality'
          }
        }

        stage('Quality / Node 22') {
          steps {
            sh 'bash .ci/run-jenkins-job.sh node22-ci quality'
          }
        }

        stage('Quality / Node 24') {
          steps {
            sh 'bash .ci/run-jenkins-job.sh node24-ci quality'
          }
        }

        stage('Dependency audit') {
          steps {
            sh 'bash .ci/run-jenkins-job.sh audit-ci audit'
          }
        }
      }
    }

    stage('GitHub dependency consumer') {
      options {
        timeout(time: 8, unit: 'MINUTES')
      }
      steps {
        sh 'bash .ci/run-jenkins-job.sh github-consumer-ci github-consumer'
      }
    }

    stage('Package artifacts') {
      options {
        timeout(time: 5, unit: 'MINUTES')
      }
      steps {
        sh '''
          set -euo pipefail
          bash .ci/run-jenkins-job.sh node24-ci artifact
          mkdir -p .artifacts
          docker compose -f "$COMPOSE_FILE" run --rm -T node24-ci \
            tar -cf - -C /workspace .artifacts dist | tar -xf -
        '''
        archiveArtifacts artifacts: '.artifacts/*.tgz,dist/**', fingerprint: true
      }
    }
  }

  post {
    always {
      sh '''
        if [ -f "$COMPOSE_FILE" ]; then
          docker compose -f "$COMPOSE_FILE" down --volumes --remove-orphans || true
        fi
      '''
      deleteDir()
    }
  }
}
