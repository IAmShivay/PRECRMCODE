// Script to check users in the database
const API_BASE_URL = 'https://api.nocodebackend.com';
const INSTANCE = '54182_scraft_crm_database';
const API_KEY = process.env.API_KEY;
if (!API_KEY) throw new Error('Set API_KEY in the environment before running this script.');

async function readAllUsers() {
  try {
    const response = await fetch(
      `${API_BASE_URL}/read/users?Instance=${INSTANCE}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
        },
      }
    );

    const data = await response.json();
    console.log('All users in database:');
    console.log(JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error('Error fetching users:', error);
  }
}

async function searchAllUsers() {
  try {
    const response = await fetch(
      `${API_BASE_URL}/search/users?Instance=${INSTANCE}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({}), // Empty search to get all
      }
    );

    const data = await response.json();
    console.log('Search results (all users):');
    console.log(JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error('Error searching users:', error);
  }
}

async function readWorkspaces() {
  try {
    const response = await fetch(
      `${API_BASE_URL}/read/workspaces?Instance=${INSTANCE}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
        },
      }
    );

    const data = await response.json();
    console.log('All workspaces in database:');
    console.log(JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error('Error fetching workspaces:', error);
  }
}

async function readWorkspaceMembers() {
  try {
    const response = await fetch(
      `${API_BASE_URL}/read/workspace_members?Instance=${INSTANCE}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
        },
      }
    );

    const data = await response.json();
    console.log('All workspace members in database:');
    console.log(JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error('Error fetching workspace members:', error);
  }
}

// Run all checks
async function main() {
  console.log('=== CHECKING DATABASE ===\n');

  console.log('\n--- USERS ---');
  await readAllUsers();

  console.log('\n--- SEARCH USERS ---');
  await searchAllUsers();

  console.log('\n--- WORKSPACES ---');
  await readWorkspaces();

  console.log('\n--- WORKSPACE MEMBERS ---');
  await readWorkspaceMembers();

  console.log('\n=== END ===');
}

main();
