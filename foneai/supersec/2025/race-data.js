/* race-data.js */

const raceConfig = {
    "aus": { country: "Australia" },
    "chn": { country: "China" },
    "jpn": { country: "Japan" },
    "bah": { country: "Bahrain" },
    "sar": { country: "Saudi Arabia" },
    "mim": { location: "Miami" },
    "ity_imola": { location: "Imola" },
    "mon": { country: "Monaco" },
    "can": { country: "Canada" },
    "cat": { country: "Spain" },
    "atr": { country: "Austria" },
    "eng": { country: "United Kingdom" },
    "hun": { country: "Hungary" },
    "bel": { country: "Belgium" },
    "nel": { country: "Netherlands" },
    "ity": { location: "Monza" },
    "abn": { country: "Azerbaijan" },
    "sgp": { country: "Singapore" },
    "aut": { location: "Austin" },
    "mex": { country: "Mexico" },
    "brl": { country: "Brazil" },
    "veg": { location: "Las Vegas" },
    "qtr": { country: "Qatar" },
    "uae": { location: "Abu Dhabi" }
};

async function fetchOpenF1Data(raceId) {
    const tableBody = document.getElementById("driver-table-body");
    const raceInfoBox = document.getElementById("race-info");
    tableBody.innerHTML = "<tr><td colspan='9' class='loading'>LOADING TELEMETRY...</td></tr>";

    try {
        // 1. Fetch 2025 meetings
        const meetingsRes = await fetch("https://api.openf1.org/v1/meetings?year=2025");
        const meetings = await meetingsRes.json();

        // 2. Find correct meeting
        const config = raceConfig[raceId];
        let meeting = null;
        for (const m of meetings) {
            if (m.meeting_name && m.meeting_name.toLowerCase().includes('testing')) continue;

            if (config.country && m.country_name && m.country_name.toLowerCase().includes(config.country.toLowerCase())) {
                meeting = m;
                break;
            }
            if (config.location && m.location && m.location.toLowerCase().includes(config.location.toLowerCase())) {
                meeting = m;
                break;
            }
        }

        if (!meeting) {
            tableBody.innerHTML = "<tr><td colspan='9' class='loading'>RACE DATA NOT YET AVAILABLE FOR 2025</td></tr>";
            return;
        }

        const meetingKey = meeting.meeting_key;

        // 3. Fetch qualifying session (Qualifying) for this meeting
        const sessionsRes = await fetch(`https://api.openf1.org/v1/sessions?meeting_key=${meetingKey}`);
        const sessions = await sessionsRes.json();
        const qualySession = sessions.find(s => s.session_name && s.session_name.toLowerCase() === "qualifying");

        if (!qualySession) {
            tableBody.innerHTML = "<tr><td colspan='9' class='loading'>QUALIFYING SESSION NOT YET AVAILABLE</td></tr>";
            raceInfoBox.innerHTML = `<div>CIRCUIT: ${meeting.circuit_short_name.toUpperCase()}</div><div>SESSION: NA</div>`;
            return;
        }

        const sessionKey = qualySession.session_key;

        // Format to GMT string
        const sessionDate = new Date(qualySession.date_start);
        const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' };
        const dateStr = sessionDate.toLocaleString('en-GB', options);

        raceInfoBox.innerHTML = `<div>CIRCUIT: ${meeting.circuit_short_name.toUpperCase()}</div><div>SESSION DATE: ${dateStr.toUpperCase()}</div>`;

        // 4. Fetch drivers
        const driversRes = await fetch(`https://api.openf1.org/v1/drivers?session_key=${sessionKey}`);
        const drivers = await driversRes.json();

        // Fetch qualifying positions separately as requested
        const posRes = await fetch(`https://api.openf1.org/v1/position?session_key=${sessionKey}`);
        const positions = await posRes.json();

        const latestPos = new Map();
        for (const p of positions) {
            latestPos.set(p.driver_number, p.position);
        }

        const driverMap = new Map();
        for (const d of drivers) {
            driverMap.set(d.driver_number, {
                name: d.full_name,
                number: d.driver_number,
                team: d.team_name,
                color: d.team_colour,
                s1: Infinity,
                s2: Infinity,
                s3: Infinity,
                qualyPos: latestPos.get(d.driver_number) || "NA"
            });
        }

        // 5. Fetch laps
        const lapsRes = await fetch(`https://api.openf1.org/v1/laps?session_key=${sessionKey}`);
        const laps = await lapsRes.json();

        // 6. Process laps
        for (const lap of laps) {
            const dn = lap.driver_number;
            if (!driverMap.has(dn)) continue;

            const driverInfo = driverMap.get(dn);
            if (lap.duration_sector_1) driverInfo.s1 = Math.min(driverInfo.s1, lap.duration_sector_1);
            if (lap.duration_sector_2) driverInfo.s2 = Math.min(driverInfo.s2, lap.duration_sector_2);
            if (lap.duration_sector_3) driverInfo.s3 = Math.min(driverInfo.s3, lap.duration_sector_3);
        }

        // Generate data array
        let driverData = Array.from(driverMap.values());

        // Calculate Super Lap beforehand for sorting
        driverData.forEach(drv => {
            if (drv.s1 !== Infinity && drv.s2 !== Infinity && drv.s3 !== Infinity) {
                drv.superLapVal = drv.s1 + drv.s2 + drv.s3;
            } else {
                drv.superLapVal = Infinity; // Push NAs to bottom
            }
        });

        // Sort by Super Lap value ascending
        driverData.sort((a, b) => {
            return a.superLapVal - b.superLapVal;
        });

        tableBody.innerHTML = "";

        // Render table
        let sl = 1;
        for (const drv of driverData) {
            const row = document.createElement("tr");

            // Compute super lap (already computed during sort)
            let superLapVal = drv.superLapVal !== Infinity ? drv.superLapVal : null;

            row.innerHTML = `
                <td>${sl++}</td>
                <td style="text-align: left;"><span style="border-left: 4px solid #${drv.color || 'FFFFFF'}; padding-left: 8px;">${(drv.name || "NA").toUpperCase()}</span></td>
                <td>${drv.number || "NA"}</td>
                <td style="text-align: left;">${(drv.team || "NA").toUpperCase()}</td>
                <td>${drv.qualyPos}</td>
                <td>${formatTime(drv.s1)}</td>
                <td>${formatTime(drv.s2)}</td>
                <td>${formatTime(drv.s3)}</td>
                <td class="super-lap">${formatTime(superLapVal)}</td>
            `;
            tableBody.appendChild(row);
        }

    } catch (err) {
        console.error(err);
        tableBody.innerHTML = "<tr><td colspan='9' class='loading'>ERROR FETCHING TELEMETRY. RETRY LATER.</td></tr>";
    }
}

// Time format logic (critical – implement exactly)
function formatTime(secondsFloat) {
    if (!secondsFloat || secondsFloat === Infinity) return "NA";
    const totalMs = Math.round(secondsFloat * 1000);
    let min = Math.floor(totalMs / 60000);
    let sec = Math.floor((totalMs % 60000) / 1000);
    let ms = totalMs % 1000;

    let secStr = sec < 10 && min > 0 ? "0" + sec : sec;
    let msStr = ms.toString().padStart(3, "0");

    if (min > 0) {
        return `${min}:${secStr}.${msStr}`;
    } else {
        return `${secStr}.${msStr}`;
    }
}
