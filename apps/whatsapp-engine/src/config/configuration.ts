export default () => ({
  port: parseInt(process.env.PORT || '3004', 10),
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  },
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'mediflow-verify-token',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    apiBaseUrl: 'https://graph.facebook.com/v18.0',
  },
  services: {
    patientServiceUrl: process.env.PATIENT_SERVICE_URL || 'http://patient-service:3000',
    appointmentServiceUrl: process.env.APPOINTMENT_SERVICE_URL || 'http://appointment-service:3000',
  },
  sessionTtl: 86400,
});
