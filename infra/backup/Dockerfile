# B14 (backend plan 17.4): the backup image. pg_dump/pg_restore 17 (the database's major version), age to encrypt
# and rclone to upload to the backup bucket (R2; MinIO for the local drill). Built and pushed with the app image by
# the deploy workflow; runs as the unprivileged `postgres` user.
FROM postgres:17.11-alpine3.23
RUN apk add --no-cache bash=5.3.3-r1 age=1.2.1-r15 rclone=1.72.1-r4
COPY backup.sh restore-check.sh /usr/local/bin/
ENV HOME=/tmp RCLONE_CONFIG=/tmp/rclone.conf RCLONE_LOG_LEVEL=ERROR
USER postgres
ENTRYPOINT ["bash", "/usr/local/bin/backup.sh"]
