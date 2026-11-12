from opentrons import protocol_api, types
from itertools import groupby
from operator import itemgetter
import requests
metadata = {
    "protocolName": "Active Learning Training Data Plate 3 Assembly",
    "description": "A protocol to assemble the third training data plate for the Active Learning experiment.",
    "author": "JATD"
}

requirements = {
    "robotType": "Flex", # Ensure the robot type is Flex,
    "apiLevel": "2.25",
    }

def notify_slack(message):
    webhook_url = ""
    try:
        requests.post(webhook_url, json={"text": message})
    except Exception as e:
        print(f"Slack notification failed: {e}")


def run(protocol: protocol_api.ProtocolContext):
    ### ------------------------------ Initialisation ------------------------------###
    # first initialise the final assembly plate
    assembly_plate_layout = ([
{'Plate': 3, 'Well': 'A1', 'Combination_ID': 'Combo_0065', 'Promoter': 'P1m', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T1d', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'A2', 'Combination_ID': 'Combo_0066', 'Promoter': 'P1m', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T1m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'A3', 'Combination_ID': 'Combo_0067', 'Promoter': 'P1m', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T2m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'A4', 'Combination_ID': 'Combo_0068', 'Promoter': 'P1m', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T12m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'A5', 'Combination_ID': 'Combo_0069', 'Promoter': 'P1m', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T13m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'A6', 'Combination_ID': 'Combo_0070', 'Promoter': 'P1m', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T14m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'A7', 'Combination_ID': 'Combo_0071', 'Promoter': 'P1m', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T16m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'A8', 'Combination_ID': 'Combo_0072', 'Promoter': 'P1m', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T18m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'A9', 'Combination_ID': 'Combo_0073', 'Promoter': 'P1m', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T1d', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'A10', 'Combination_ID': 'Combo_0074', 'Promoter': 'P1m', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T1m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'A11', 'Combination_ID': 'Combo_0075', 'Promoter': 'P1m', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T2m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'A12', 'Combination_ID': 'Combo_0076', 'Promoter': 'P1m', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T12m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'B1', 'Combination_ID': 'Combo_0077', 'Promoter': 'P1m', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T13m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'B2', 'Combination_ID': 'Combo_0078', 'Promoter': 'P1m', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T14m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'B3', 'Combination_ID': 'Combo_0079', 'Promoter': 'P1m', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T16m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'B4', 'Combination_ID': 'Combo_0080', 'Promoter': 'P1m', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T18m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'B5', 'Combination_ID': 'Combo_0081', 'Promoter': 'P1m', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T1d', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'B6', 'Combination_ID': 'Combo_0082', 'Promoter': 'P1m', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T1m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'B7', 'Combination_ID': 'Combo_0083', 'Promoter': 'P1m', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T2m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'B8', 'Combination_ID': 'Combo_0084', 'Promoter': 'P1m', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T12m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'B9', 'Combination_ID': 'Combo_0085', 'Promoter': 'P1m', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T13m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'B10', 'Combination_ID': 'Combo_0086', 'Promoter': 'P1m', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T14m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'B11', 'Combination_ID': 'Combo_0087', 'Promoter': 'P1m', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T16m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'B12', 'Combination_ID': 'Combo_0088', 'Promoter': 'P1m', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T18m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'C1', 'Combination_ID': 'Combo_0089', 'Promoter': 'P1m', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T1d', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'C2', 'Combination_ID': 'Combo_0090', 'Promoter': 'P1m', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T1m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'C3', 'Combination_ID': 'Combo_0091', 'Promoter': 'P1m', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T2m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'C4', 'Combination_ID': 'Combo_0092', 'Promoter': 'P1m', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T12m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'C5', 'Combination_ID': 'Combo_0093', 'Promoter': 'P1m', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T13m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'C6', 'Combination_ID': 'Combo_0094', 'Promoter': 'P1m', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T14m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'C7', 'Combination_ID': 'Combo_0095', 'Promoter': 'P1m', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T16m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'C8', 'Combination_ID': 'Combo_0096', 'Promoter': 'P1m', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T18m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'C9', 'Combination_ID': 'Combo_0097', 'Promoter': 'P1m', 'UTR': 'U5d', 'CDS': 'C1J', 'Terminator': 'T1d', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'C10', 'Combination_ID': 'Combo_0098', 'Promoter': 'P1m', 'UTR': 'U5d', 'CDS': 'C1J', 'Terminator': 'T1m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'C11', 'Combination_ID': 'Combo_0099', 'Promoter': 'P1m', 'UTR': 'U5d', 'CDS': 'C1J', 'Terminator': 'T2m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'C12', 'Combination_ID': 'Combo_0100', 'Promoter': 'P1m', 'UTR': 'U5d', 'CDS': 'C1J', 'Terminator': 'T12m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'D1', 'Combination_ID': 'Combo_0101', 'Promoter': 'P1m', 'UTR': 'U5d', 'CDS': 'C1J', 'Terminator': 'T13m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'D2', 'Combination_ID': 'Combo_0102', 'Promoter': 'P1m', 'UTR': 'U5d', 'CDS': 'C1J', 'Terminator': 'T14m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'D3', 'Combination_ID': 'Combo_0103', 'Promoter': 'P1m', 'UTR': 'U5d', 'CDS': 'C1J', 'Terminator': 'T16m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'D4', 'Combination_ID': 'Combo_0104', 'Promoter': 'P1m', 'UTR': 'U5d', 'CDS': 'C1J', 'Terminator': 'T18m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'D5', 'Combination_ID': 'Combo_0105', 'Promoter': 'P1m', 'UTR': 'U6d', 'CDS': 'C1J', 'Terminator': 'T1d', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'D6', 'Combination_ID': 'Combo_0106', 'Promoter': 'P1m', 'UTR': 'U6d', 'CDS': 'C1J', 'Terminator': 'T1m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'D7', 'Combination_ID': 'Combo_0107', 'Promoter': 'P1m', 'UTR': 'U6d', 'CDS': 'C1J', 'Terminator': 'T2m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'D8', 'Combination_ID': 'Combo_0108', 'Promoter': 'P1m', 'UTR': 'U6d', 'CDS': 'C1J', 'Terminator': 'T12m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'D9', 'Combination_ID': 'Combo_0109', 'Promoter': 'P1m', 'UTR': 'U6d', 'CDS': 'C1J', 'Terminator': 'T13m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'D10', 'Combination_ID': 'Combo_0110', 'Promoter': 'P1m', 'UTR': 'U6d', 'CDS': 'C1J', 'Terminator': 'T14m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'D11', 'Combination_ID': 'Combo_0111', 'Promoter': 'P1m', 'UTR': 'U6d', 'CDS': 'C1J', 'Terminator': 'T16m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'D12', 'Combination_ID': 'Combo_0112', 'Promoter': 'P1m', 'UTR': 'U6d', 'CDS': 'C1J', 'Terminator': 'T18m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'E1', 'Combination_ID': 'Combo_0113', 'Promoter': 'P1m', 'UTR': 'U9m', 'CDS': 'C1J', 'Terminator': 'T1d', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'E2', 'Combination_ID': 'Combo_0114', 'Promoter': 'P1m', 'UTR': 'U9m', 'CDS': 'C1J', 'Terminator': 'T1m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'E3', 'Combination_ID': 'Combo_0115', 'Promoter': 'P1m', 'UTR': 'U9m', 'CDS': 'C1J', 'Terminator': 'T2m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'E4', 'Combination_ID': 'Combo_0116', 'Promoter': 'P1m', 'UTR': 'U9m', 'CDS': 'C1J', 'Terminator': 'T12m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'E5', 'Combination_ID': 'Combo_0117', 'Promoter': 'P1m', 'UTR': 'U9m', 'CDS': 'C1J', 'Terminator': 'T13m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'E6', 'Combination_ID': 'Combo_0118', 'Promoter': 'P1m', 'UTR': 'U9m', 'CDS': 'C1J', 'Terminator': 'T14m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'E7', 'Combination_ID': 'Combo_0119', 'Promoter': 'P1m', 'UTR': 'U9m', 'CDS': 'C1J', 'Terminator': 'T16m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'E8', 'Combination_ID': 'Combo_0120', 'Promoter': 'P1m', 'UTR': 'U9m', 'CDS': 'C1J', 'Terminator': 'T18m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'E9', 'Combination_ID': 'Combo_0121', 'Promoter': 'P1m', 'UTR': 'U17m', 'CDS': 'C1J', 'Terminator': 'T1d', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'E10', 'Combination_ID': 'Combo_0122', 'Promoter': 'P1m', 'UTR': 'U17m', 'CDS': 'C1J', 'Terminator': 'T1m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'E11', 'Combination_ID': 'Combo_0123', 'Promoter': 'P1m', 'UTR': 'U17m', 'CDS': 'C1J', 'Terminator': 'T2m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'E12', 'Combination_ID': 'Combo_0124', 'Promoter': 'P1m', 'UTR': 'U17m', 'CDS': 'C1J', 'Terminator': 'T12m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'F1', 'Combination_ID': 'Combo_0125', 'Promoter': 'P1m', 'UTR': 'U17m', 'CDS': 'C1J', 'Terminator': 'T13m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'F2', 'Combination_ID': 'Combo_0126', 'Promoter': 'P1m', 'UTR': 'U17m', 'CDS': 'C1J', 'Terminator': 'T14m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'F3', 'Combination_ID': 'Combo_0127', 'Promoter': 'P1m', 'UTR': 'U17m', 'CDS': 'C1J', 'Terminator': 'T16m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'F4', 'Combination_ID': 'Combo_0128', 'Promoter': 'P1m', 'UTR': 'U17m', 'CDS': 'C1J', 'Terminator': 'T18m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'F5', 'Combination_ID': 'Combo_0129', 'Promoter': 'P2d', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T1d', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'F6', 'Combination_ID': 'Combo_0130', 'Promoter': 'P2d', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T1m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'F7', 'Combination_ID': 'Combo_0131', 'Promoter': 'P2d', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T2m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'F8', 'Combination_ID': 'Combo_0132', 'Promoter': 'P2d', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T12m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'F9', 'Combination_ID': 'Combo_0133', 'Promoter': 'P2d', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T13m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'F10', 'Combination_ID': 'Combo_0134', 'Promoter': 'P2d', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T14m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'F11', 'Combination_ID': 'Combo_0135', 'Promoter': 'P2d', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T16m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'F12', 'Combination_ID': 'Combo_0136', 'Promoter': 'P2d', 'UTR': 'U1d', 'CDS': 'C1J', 'Terminator': 'T18m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'G1', 'Combination_ID': 'Combo_0137', 'Promoter': 'P2d', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T1d', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'G2', 'Combination_ID': 'Combo_0138', 'Promoter': 'P2d', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T1m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'G3', 'Combination_ID': 'Combo_0139', 'Promoter': 'P2d', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T2m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'G4', 'Combination_ID': 'Combo_0140', 'Promoter': 'P2d', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T12m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'G5', 'Combination_ID': 'Combo_0141', 'Promoter': 'P2d', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T13m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'G6', 'Combination_ID': 'Combo_0142', 'Promoter': 'P2d', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T14m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'G7', 'Combination_ID': 'Combo_0143', 'Promoter': 'P2d', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T16m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'G8', 'Combination_ID': 'Combo_0144', 'Promoter': 'P2d', 'UTR': 'U2d', 'CDS': 'C1J', 'Terminator': 'T18m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'G9', 'Combination_ID': 'Combo_0145', 'Promoter': 'P2d', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T1d', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'G10', 'Combination_ID': 'Combo_0146', 'Promoter': 'P2d', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T1m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'G11', 'Combination_ID': 'Combo_0147', 'Promoter': 'P2d', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T2m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'G12', 'Combination_ID': 'Combo_0148', 'Promoter': 'P2d', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T12m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'H1', 'Combination_ID': 'Combo_0149', 'Promoter': 'P2d', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T13m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'H2', 'Combination_ID': 'Combo_0150', 'Promoter': 'P2d', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T14m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'H3', 'Combination_ID': 'Combo_0151', 'Promoter': 'P2d', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T16m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'H4', 'Combination_ID': 'Combo_0152', 'Promoter': 'P2d', 'UTR': 'U4d', 'CDS': 'C1J', 'Terminator': 'T18m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'H5', 'Combination_ID': 'Combo_0153', 'Promoter': 'P2d', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T1d', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'H6', 'Combination_ID': 'Combo_0154', 'Promoter': 'P2d', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T1m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'H7', 'Combination_ID': 'Combo_0155', 'Promoter': 'P2d', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T2m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'H8', 'Combination_ID': 'Combo_0156', 'Promoter': 'P2d', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T12m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'H9', 'Combination_ID': 'Combo_0157', 'Promoter': 'P2d', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T13m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'H10', 'Combination_ID': 'Combo_0158', 'Promoter': 'P2d', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T14m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'H11', 'Combination_ID': 'Combo_0159', 'Promoter': 'P2d', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T16m', 'Vector': 'V37m'},
{'Plate': 3, 'Well': 'H12', 'Combination_ID': 'Combo_0160', 'Promoter': 'P2d', 'UTR': 'U4m', 'CDS': 'C1J', 'Terminator': 'T18m', 'Vector': 'V37m'}
       ])


    part_repo_plate = ([
    {'name': 'C3m', 'well': 'A1'},
    {'name': 'P1d', 'well': 'A2'},
    {'name': 'P1m', 'well': 'A3'},
    {'name': 'P2d', 'well': 'A4'},
    {'name': 'P3d', 'well': 'A5'},
    {'name': 'P3m', 'well': 'A6'},
    {'name': 'P4d', 'well': 'A7'},
    {'name': 'P4m', 'well': 'A8'},
    {'name': 'P5d', 'well': 'A9'},
    {'name': 'P6d', 'well': 'A10'},
    {'name': 'P7d', 'well': 'A11'},
    {'name': 'P8d', 'well': 'A12'},
    {'name': 'P9d', 'well': 'B1'},
    {'name': 'P9m', 'well': 'B2'},
    {'name': 'P10d', 'well': 'B3'},
    {'name': 'P12m', 'well': 'B4'},
    {'name': 'P15m', 'well': 'B5'},
    {'name': 'P16m', 'well': 'B6'},
    {'name': 'P18m', 'well': 'B7'},
    {'name': 'P30m', 'well': 'B8'},
    {'name': 'P32m', 'well': 'B9'},
    {'name': 'P33m', 'well': 'B10'},
    {'name': 'P34m', 'well': 'B11'},
    {'name': 'P35m', 'well': 'B12'},
    {'name': 'P37m', 'well': 'C1'},
    {'name': 'P38m', 'well': 'C2'},
    {'name': 'P57m', 'well': 'C3'},
    {'name': 'P58m', 'well': 'C4'},
    {'name': 'P59m', 'well': 'C5'},
    {'name': 'P60m', 'well': 'C6'},
    {'name': 'P61m', 'well': 'C7'},
    {'name': 'P66m', 'well': 'C8'},
    {'name': 'T1d', 'well': 'C9'},
    {'name': 'T1m', 'well': 'C10'},
    {'name': 'T2m', 'well': 'C11'},
    {'name': 'T7m', 'well': 'C12'},
    {'name': 'T12m', 'well': 'D1'},
    {'name': 'T13m', 'well': 'D2'},
    {'name': 'T14m', 'well': 'D3'},
    {'name': 'T15m', 'well': 'D4'},
    {'name': 'T16m', 'well': 'D5'},
    {'name': 'T17m', 'well': 'D6'},
    {'name': 'T18m', 'well': 'D7'},
    {'name': 'U1d', 'well': 'D8'},
    {'name': 'U2d', 'well': 'D9'},
    {'name': 'U2m', 'well': 'D10'},
    {'name': 'U3d', 'well': 'D11'},
    {'name': 'U3m', 'well': 'D12'},
    {'name': 'U4d', 'well': 'E1'},
    {'name': 'U4m', 'well': 'E2'},
    {'name': 'U5d', 'well': 'E3'},
    {'name': 'U5m', 'well': 'E4'},
    {'name': 'U6d', 'well': 'E5'},
    {'name': 'U6m', 'well': 'E6'},
    {'name': 'U7m', 'well': 'E7'},
    {'name': 'U8m', 'well': 'F8'},
    {'name': 'U9m', 'well': 'E9'},
    {'name': 'U17m', 'well': 'E10'},
    {'name': 'U19m', 'well': 'E11'},
    {'name': 'U22m', 'well': 'E12'},
    {'name': 'U24m', 'well': 'F1'},
    {'name': 'U25m', 'well': 'F2'},
    {'name': 'V7d', 'well': 'F3'},
    {'name': 'V37m', 'well': 'F4'},
    {'name': 'C1J', 'well': 'F5'},
    {'name': 'C2J', 'well': 'F6'},
    {'name': 'C3J', 'well': 'F7'}
    ])

    # load the labware
    tips1 = protocol.load_labware("opentrons_flex_96_tiprack_50ul", "A2")
    tips2 = protocol.load_labware("opentrons_flex_96_tiprack_50ul", "B2")
    tips3 = protocol.load_labware("opentrons_flex_96_tiprack_50ul", "C2")
    tubes = protocol.load_labware("jd_24_tuberack_1.5ml", "B3")
    trash = protocol.load_trash_bin("A3")

    tc_mod = protocol.load_module(module_name="thermocyclerModuleV2")
    plate_1 = protocol.load_labware("opentrons_96_wellplate_200ul_pcr_full_skirt","C1")
    plate_2 = tc_mod.load_labware("opentrons_96_wellplate_200ul_pcr_full_skirt")
    left_pipette = protocol.load_instrument(
        "flex_1channel_50",
        mount="left",
        tip_racks=[tips1,tips2,tips3]
    )
    tc_mod.open_lid()
    tc_mod.set_block_temperature(4)
    left_pipette.default_speed = 500
    #------------------------------ Assembly Protocol ------------------------------#
    
    # Initialize tip counter
    tip_count = 0
    
    # Create a mapping from part name to well location in the repo plate
    part_to_well = {part['name']: part['well'] for part in part_repo_plate}
    
    # Function to find the well location for a given part
    def get_part_well(part_name):
        # Handle special cases for part names with colons
        if part_name in part_to_well:
            return part_to_well[part_name]
        # Handle cases like "P9d: PTet" -> "P9d" or "P10d: PLuxR-pL" -> "P10d"
        base_name = part_name.split(':')[0].strip()
        if base_name in part_to_well:
            return part_to_well[base_name]
        else:
            protocol.comment(f"Warning: Part {part_name} not found in repo plate")
            return None
    #------------------------------- MM Addition Step -------------------------------#

    # Add enzyme master mix to each well first (7 µL)
    protocol.comment("Adding enzyme master mix to all wells...")
    enzyme_tube = tubes['B2']  # Assuming enzyme master mix is in tube B2 so it stays at lower temp
    
    # Flatten all wells into a single list and sort by well name for systematic processing
    all_wells = sorted(assembly_plate_layout, key=lambda x: (int(x['Well'][1:]), x['Well'][0]))
    
    left_pipette.pick_up_tip()
    # Pre-wet the tip with enzyme mix for better accuracy
    left_pipette.aspirate(10, enzyme_tube)
    left_pipette.dispense(10, enzyme_tube)

    # Process wells in groups of 6
    wells_per_batch = 6
    total_wells = len(all_wells)
    
    for batch_num in range(0, total_wells, wells_per_batch):
        batch_wells = all_wells[batch_num:batch_num + wells_per_batch]
        actual_batch_size = len(batch_wells)
        
        protocol.comment(f"Processing wells {batch_num + 1} to {batch_num + actual_batch_size} of {total_wells}")
        
        # Aspirate enough enzyme mix for this batch (7 µL per well + small buffer)
        aspirate_volume = 50  
        left_pipette.aspirate(aspirate_volume, enzyme_tube.bottom(1))

        for assembly in batch_wells:
            dest_well = assembly['Well']
            left_pipette.dispense(7, plate_2[dest_well].bottom().move(types.Point(x=-0.2, y=0, z=0)), rate=0.5)
            left_pipette.touch_tip(plate_2[dest_well], v_offset=-3)  # Touch tip to remove droplets

        # Return any residual enzyme mix to the source tube
        left_pipette.blow_out(enzyme_tube.bottom(3))
        
    
    left_pipette.drop_tip()

    protocol.comment("Enzyme MM has been distributed")
    
    #------------------------------- Part Addition Steps -------------------------------#

    # Sort the assembly layout by Promoter and UTR
    assembly_plate_layout_sorted = sorted(assembly_plate_layout, key=itemgetter('Promoter', 'UTR'))

    # Step 1: Add Promoters - group by promoter and use reverse pipetting
    protocol.comment("Adding Promoters...")
    for promoter, promoter_group in groupby(assembly_plate_layout_sorted, key=itemgetter('Promoter')):
        promoter_list = list(promoter_group)  # Convert to list so we can iterate multiple times
        protocol.comment(f"Processing Promoter: {promoter}")
        
        source_well = get_part_well(promoter)
        if source_well:
            protocol.comment(f"  Adding Promoter {promoter} from {source_well}")
            tip_count += 1
            left_pipette.pick_up_tip()
                  # Pre-wet the tip with promoter for better accuracy
            left_pipette.aspirate(5, plate_1[source_well].bottom(1))
            left_pipette.dispense(5, plate_1[source_well].bottom(1))  # Dispense back to source

            for assembly in promoter_list:
                dest_well = assembly['Well']                
                # Aspirate promoter
                left_pipette.aspirate(1, plate_1[source_well].bottom(1))
                # Dispense at bottom of destination well with increased speed
                left_pipette.dispense(1, plate_2[dest_well].bottom(), rate=0.5)
                left_pipette.blow_out(plate_2[dest_well].bottom(1))  # Blow out to ensure full transfer
            
            left_pipette.drop_tip()
        else:
            protocol.comment(f"  Skipping Promoter {promoter} - not found in repo plate")

# Step 2: Add UTRs - group by promoter first, then UTR to optimize tip usage
    protocol.comment("Adding UTRs...")
    assembly_sorted_by_promoter_utr = sorted(assembly_plate_layout, key=itemgetter('Promoter', 'UTR'))
    for (promoter, utr), promoter_utr_group in groupby(assembly_sorted_by_promoter_utr, key=itemgetter('Promoter', 'UTR')):
        promoter_utr_list = list(promoter_utr_group)  # Convert to list so we can iterate multiple times
        protocol.comment(f"Processing UTR: {utr} for Promoter: {promoter}")
        
        source_well = get_part_well(utr)
        if source_well:
            protocol.comment(f"  Adding UTR {utr} from {source_well}")
            tip_count += 1
            left_pipette.pick_up_tip()
            # Pre-wet the tip with promoter for better accuracy
            left_pipette.aspirate(5, plate_1[source_well].bottom(1))
            left_pipette.dispense(5, plate_1[source_well].bottom(1))  # Dispense back to source
            for assembly in promoter_utr_list:
                dest_well = assembly['Well']
                
                # Aspirate promoter
                left_pipette.aspirate(1, plate_1[source_well].bottom(1))
                # Dispense at bottom of destination well with increased speed
                left_pipette.dispense(1, plate_2[dest_well].bottom(1), rate=0.5)
                left_pipette.blow_out(plate_2[dest_well].bottom(1))  # Blow out to ensure full transfer

            left_pipette.drop_tip()
            
        else:
            protocol.comment(f"  Skipping UTR {utr} - not found in repo plate")
# Step 3: Add Terminators - change tip every time  
    protocol.comment("Adding Terminators...")
    assembly_sorted_by_terminator = sorted(assembly_plate_layout, key=itemgetter('Terminator'))
    for terminator, terminator_group in groupby(assembly_sorted_by_terminator, key=itemgetter('Terminator')):
        terminator_list = list(terminator_group)  # Convert to list so we can iterate multiple times
        protocol.comment(f"Processing Terminator: {terminator}")
        
        source_well = get_part_well(terminator)
        if source_well:
            protocol.comment(f"  Adding Terminator {terminator} from {source_well}")
            for assembly in terminator_list:
                tip_count += 1
                dest_well = assembly['Well']
                
                # Pick up fresh tip for each transfer
                left_pipette.pick_up_tip()
                
                # Pre-wet the tip with terminator for better accuracy
                #left_pipette.aspirate(5, plate_1[source_well])
                #left_pipette.dispense(5, plate_1[source_well])  # Dispense back to source
                
                # Aspirate terminator
                left_pipette.aspirate(1, plate_1[source_well].bottom(2))
                # Dispense at bottom of destination well with increased speed
                left_pipette.dispense(1, plate_2[dest_well].bottom(1), rate=0.5)
                left_pipette.blow_out(plate_2[dest_well].bottom(1))  # Blow out to ensure full transfer
                # Drop tip after each transfer
                left_pipette.drop_tip()
        else:
            protocol.comment(f"  Skipping Terminator {terminator} - not found in repo plate")
    notify_slack("Assembly complete. Please seal plate before starting thermocycler protocol")
    protocol.pause("Assembly complete. Please seal plate before starting thermocycler protocol")
   


    #------------------------------ Thermocycler protocol for Golden Gate assembly ------------------------------#

    # Golden Gate cycling protocol
    tc_mod.close_lid()
    #heat lid to prevent condensation
    tc_mod.set_lid_temperature(105) 

    cycles = 50  # adjust as needed
    cut_temp = 37  # Change to 42 if your enzyme requires it
    lig_temp = 16  # ligation temperature, change to 20 if your enzyme requires it
    cut_time = 1   # minutes
    lig_time = 1   # minutes


    profile = [
        {"temperature": cut_temp, "hold_time_minutes": cut_time},
        {"temperature": lig_temp, "hold_time_minutes": lig_time}
    ]

    tc_mod.execute_profile(steps=profile, repetitions=cycles, block_max_volume=10)
    
    # Enzyme inactivation
    tc_mod.set_block_temperature(60, hold_time_minutes=5)
    # Hold at 4°C until retrieval
    tc_mod.set_block_temperature(4)
    protocol.comment("Thermocycling complete. Please retrieve your plate from the thermocycler.")
    notify_slack("Thermocycling complete. Holding at 4°C until retrieval.")