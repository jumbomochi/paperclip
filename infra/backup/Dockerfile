FROM postgres:16-alpine
RUN apk add --no-cache curl gzip py3-pip ca-certificates && \
    pip install --no-cache-dir --break-system-packages b2
COPY backup.sh /backup.sh
COPY restore.sh /restore.sh
RUN chmod +x /backup.sh /restore.sh
ENV BACKUP_CRON="0 5 * * *"
CMD ["sh", "-c", "echo \"$BACKUP_CRON /backup.sh\" > /etc/crontabs/root && crond -f -l 2"]
