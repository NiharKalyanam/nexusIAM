import axios from 'axios';

const API = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
});



export default API;
