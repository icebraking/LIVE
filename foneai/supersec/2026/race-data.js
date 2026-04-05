/* race-data.js — 2026 Season */

const raceConfig = {
    "aus": { country: "Australia", qualyDate: "2026-03-07" },
    "chn": { country: "China", qualyDate: "2026-03-14" },
    "jpn": { country: "Japan", qualyDate: "2026-03-28" },
    "bah": { country: "Bahrain", qualyDate: "2026-04-11" },
    "sar": { country: "Saudi Arabia", qualyDate: "2026-04-18" },
    "mim": { location: "Miami", qualyDate: "2026-05-02" },
    "can": { country: "Canada", qualyDate: "2026-05-23" },
    "mon": { country: "Monaco", qualyDate: "2026-06-06" },
    "cat": { country: "Spain", location: "Barcelona", qualyDate: "2026-06-13" },
    "atr": { country: "Austria", qualyDate: "2026-06-27" },
    "eng": { country: "Great Britain", qualyDate: "2026-07-04" },
    "bel": { country: "Belgium", qualyDate: "2026-07-18" },
    "hun": { country: "Hungary", qualyDate: "2026-07-25" },
    "nel": { country: "Netherlands", qualyDate: "2026-08-22" },
    "ity": { location: "Monza", qualyDate: "2026-09-05" },
    "mad": { location: "Madrid", qualyDate: "2026-09-12" },
    "abn": { country: "Azerbaijan", qualyDate: "2026-09-25" },
    "sgp": { country: "Singapore", qualyDate: "2026-10-10" },
    "aut": { location: "Austin", qualyDate: "2026-10-24" },
    "mex": { country: "Mexico", qualyDate: "2026-10-31" },
    "brl": { country: "Brazil", qualyDate: "2026-11-07" },
    "veg": { location: "Las Vegas", qualyDate: "2026-11-20" },
    "qtr": { country: "Qatar", qualyDate: "2026-11-28" },
    "uae": { location: "Abu Dhabi", qualyDate: "2026-12-05" }
};

async function fetchOpenF1Data(raceId) {
    const tableBody = document.getElementById("driver-table-body");
    const raceInfoBox = document.getElementById("race-info");

    const config = raceConfig[raceId];

    // Check if the race qualifying date is in the future
    if (config && config.qualyDate) {
        const qualyDate = new Date(config.qualyDate + "T23:59:59Z");
        const now = new Date();
        if (now < qualyDate) {
            raceInfoBox.innerHTML = `<div>CIRCUIT: ${(config.location || config.country || "").toUpperCase()}</div><div>SESSION: UPCOMING</div>`;
            tableBody.innerHTML = "<tr><td colspan='9' class='loading'>NO DATA AVAILABLE</td></tr>";
            return;
        }
    }

    tableBody.innerHTML = "<tr><td colspan='9' class='loading'>LOADING TELEMETRY...</td></tr>";

    try {
        // 1. Fetch 2026 meetings
        const meetingsRes = await fetch("https://api.openf1.org/v1/meetings?year=2026");
        const meetings = await meetingsRes.json();

        if (!meetings || meetings.length === 0) {
            raceInfoBox.innerHTML = `<div>CIRCUIT: ${(config.location || config.country || "").toUpperCase()}</div><div>SESSION: NA</div>`;
            tableBody.innerHTML = "<tr><td colspan='9' class='loading'>NO DATA AVAILABLE</td></tr>";
            return;
        }

        // 2. Find correct meeting
        let meeting = null;
        for (const m of meetings) {
            if (config.country && m.country_name && m.country_name.toLowerCase().includes(config.country.toLowerCase())) {
                // For Spain we need to differentiate Barcelona vs Madrid by location
                if (config.location) {
                    if (m.location && m.location.toLowerCase().includes(config.location.toLowerCase())) {
                        meeting = m;
                        break;
                    }
                } else {
                    meeting = m;
                    break;
                }
            }
            if (!config.country && config.location && m.location && m.location.toLowerCase().includes(config.location.toLowerCase())) {
                meeting = m;
                break;
            }
        }

        if (!meeting) {
            raceInfoBox.innerHTML = `<div>CIRCUIT: ${(config.location || config.country || "").toUpperCase()}</div><div>SESSION: NA</div>`;
            tableBody.innerHTML = "<tr><td colspan='9' class='loading'>NO DATA AVAILABLE</td></tr>";
            return;
        }

        const meetingKey = meeting.meeting_key;

        // 3. Fetch qualifying session for this meeting
        const sessionsRes = await fetch(`https://api.openf1.org/v1/sessions?meeting_key=${meetingKey}`);
        const sessions = await sessionsRes.json();
        const qualySession = sessions.find(s => s.session_name && s.session_name.toLowerCase() === "qualifying");

        if (!qualySession) {
            raceInfoBox.innerHTML = `<div>CIRCUIT: ${meeting.circuit_short_name.toUpperCase()}</div><div>SESSION: NA</div>`;
            tableBody.innerHTML = "<tr><td colspan='9' class='loading'>QUALIFYING SESSION NOT YET AVAILABLE</td></tr>";
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

        // Fetch qualifying positions
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

        // Calculate Super Lap for sorting
        driverData.forEach(drv => {
            if (drv.s1 !== Infinity && drv.s2 !== Infinity && drv.s3 !== Infinity) {
                drv.superLapVal = drv.s1 + drv.s2 + drv.s3;
            } else {
                drv.superLapVal = Infinity;
            }
        });

        // Sort by Super Lap ascending
        driverData.sort((a, b) => {
            return a.superLapVal - b.superLapVal;
        });

        tableBody.innerHTML = "";

        // Render table
        let sl = 1;
        for (const drv of driverData) {
            const row = document.createElement("tr");

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
        tableBody.innerHTML = "<tr><td colspan='9' class='loading'>NO DATA AVAILABLE</td></tr>";
    }
}

// Time format logic
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
