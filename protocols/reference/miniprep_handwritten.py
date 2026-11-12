from opentrons import protocol_api
import requests

# Set to "<@YOUR_MEMBER_ID>" to be tagged in this run's alerts.
# Slack profile -> ... -> Copy member ID. Empty means no tag.
SLACK_USER_ID = ""


def notify_slack(message):
    webhook_url = ""
    try:
        requests.post(webhook_url, json={"text": f"{SLACK_USER_ID} {message}".strip()})
    except Exception as e:
        print(f"Slack notification failed: {e}")

metadata = {
    'protocolName': 'Vacuum miniprep variable samples (dual pipette)',
    'description': (
        'Miniprep 1-24 samples using 3D printed vacuum manifold. '
        'p1000 (right mount) handles lysis, neutralisation, and wash. '
        'p50 (left mount) handles elution at 50ul. '
        'Start with resuspended cells in 1.5ml tubes.'
    ),
    'author': 'JATD'
}

requirements = {
    "robotType": "Flex",
    "apiLevel": "2.23",
}


def add_parameters(parameters: protocol_api.Parameters):
    parameters.add_int(
        variable_name="num_samples",
        display_name="Number of Samples",
        description="Number of samples to process (1-24)",
        default=24,
        minimum=1,
        maximum=24,
        unit="samples"
    )


def run(protocol: protocol_api.ProtocolContext):
    num_samples = protocol.params.num_samples
    protocol.comment(f"Processing {num_samples} samples")

    # Load tip racks and trash
    tips_1000_1 = protocol.load_labware("opentrons_flex_96_tiprack_1000ul", location="A2")
    tips_1000_2 = protocol.load_labware("opentrons_flex_96_tiprack_1000ul", location="D3")
    tips_50 = protocol.load_labware("opentrons_flex_96_tiprack_50ul", location="D2")
    trash = protocol.load_trash_bin(location="A3")

    # p50 on left for elution; p1000 on right for lysis, neutralisation, and wash
    p50 = protocol.load_instrument(
        "flex_1channel_50",
        mount="left",
        tip_racks=[tips_50]
    )
    p1000 = protocol.load_instrument(
        "flex_1channel_1000",
        mount="right",
        tip_racks=[tips_1000_1, tips_1000_2]
    )

    cells = protocol.load_labware("jd_24_tuberack_1.5ml", "B2")
    VacManifold = protocol.load_labware('jdvacuum_24_tuberack_500ul', 'B3')
    buffers = protocol.load_labware('jd_6_falconrack_50ml', 'C2')
    elution_tubes = protocol.load_labware('jd_24_tuberack_1.5ml', 'C3')

    num_columns = num_samples // 4
    remaining_wells = num_samples % 4

    try:
        ### 1 & 2. Lysis then Neutralisation, column by column ###
        # Process column by column so each column is fully lysed + neutralised
        # before moving on — avoids leaving samples in lysis buffer too long.

        for col in range(num_columns):
            column_wells = [cells.wells()[col * 4 + row] for row in range(4)]
            protocol.comment(f"Lysing column {col + 1} — wells {[w.well_name for w in column_wells]}")

            for well in column_wells:
                p1000.pick_up_tip()
                p1000.transfer(250, buffers["A1"].bottom(3), well.top(0), new_tip="never")
                # Mix with 200ul — appropriate for p1000 in a ~500ul total volume
                p1000.mix(3, 200, well)
                p1000.drop_tip()

            protocol.comment(f"Neutralising column {col + 1}")

            for well in column_wells:
                p1000.pick_up_tip()
                p1000.transfer(350, buffers["A2"].bottom(3), well.top(0), new_tip="never")
                # Mix with 300ul — appropriate after neutralisation (~850ul total)
                p1000.mix(3, 300, well)
                p1000.drop_tip()

        # Handle any remaining wells (partial column)
        if remaining_wells > 0:
            start_well = num_columns * 4
            remaining_well_list = [cells.wells()[start_well + row] for row in range(remaining_wells)]
            protocol.comment(f"Lysing remaining {remaining_wells} wells — {[w.well_name for w in remaining_well_list]}")

            for well in remaining_well_list:
                p1000.pick_up_tip()
                p1000.transfer(250, buffers["A1"].bottom(3), well.top(0), new_tip="never")
                p1000.mix(3, 200, well)
                p1000.drop_tip()

            protocol.comment(f"Neutralising remaining {remaining_wells} wells")

            for well in remaining_well_list:
                p1000.pick_up_tip()
                p1000.transfer(350, buffers["A2"].bottom(3), well.top(0), new_tip="never")
                p1000.mix(3, 300, well)
                p1000.drop_tip()

        notify_slack("Lysis and Neutralisation complete - Please spin down samples and load into vacuum manifold, then click Resume")
        protocol.pause("Spin down samples and load into vacuum manifold. Click Resume when ready.")

        ### 3. Wash — two rounds of 500ul (p1000) ###
        # p1000 handles 500ul in a single aspiration; previously required ~10x with p50
        p1000.pick_up_tip()
        for wash_round in range(2):
            protocol.comment(f"Wash round {wash_round + 1}")
            for i in range(num_samples):
                p1000.transfer(
                    500,
                    buffers["A3"].bottom(3),
                    VacManifold.wells()[i].top(1),
                    new_tip="never",
                )
        p1000.drop_tip()

        notify_slack("Washing complete - Please spin down to remove residual ethanol and transfer silica membrane to elution tubes, then click Resume")
        protocol.pause("Spin down samples to remove residual ethanol. Click Resume when ready.")

        ### 4. Elution — 50ul per sample (p50) ###
        p50.pick_up_tip()
        for i in range(num_samples):
            p50.transfer(
                50,
                buffers["B1"].bottom(3),
                elution_tubes.wells()[i].top(),
                new_tip="never"
            )
        p50.drop_tip()

        notify_slack(f"Miniprep complete for {num_samples} samples - Spin down and store elutions at -20C")
        protocol.comment(f"Protocol complete for {num_samples} samples. Spin down and store elutions at -20C.")

    except Exception as e:
        notify_slack(f":rotating_light: PROTOCOL FAILURE - Miniprep (p1000) failed with error: {str(e)}")
        raise
